// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IdentityContract.sol";

/** What a named entity reports back, for the other half of the binding. */
interface INamedEntity {
    function registrar() external view returns (address);
    function entityName() external view returns (string memory);
}

/** What an entity deployed before the registrar existed can report: the name it
 *  publishes about itself. Such a contract can claim through executeTransaction,
 *  and this is the only assertion it has — so it is read rather than forcing
 *  every identity already on chain to be minted again. */
interface ILegacyNamedEntity {
    function profileName() external view returns (string memory);
}

/** A forward identity names its DOMAIN directly — the stable, DNS-rooted
 *  identifier — rather than a registrar contract address, so a redeploy of the
 *  domain's contract never orphans it. Its rivets set it; it is built, not frozen. */
interface IDomainNamed {
    function domainName() external view returns (string memory);
}

/** Any registrar — this contract, or a prior instance of the same domain —
 *  answers for the domain it is bound to. Read to resolve an identity's registrar
 *  address through to the domain it stands under. */
interface IRegistrarDomain {
    function domain() external view returns (string memory);
}

/**
 * @title DomainContract — a domain as a legal entity, and the registrar of its names
 *
 * The corporation to {IdentityContract}'s individual: the same rivets, sections,
 * treasury and ERC-1271, plus the three things only a domain has — the domain it is
 * bound to, the names it issues, and the prices it charges.
 *
 * **The chain of bindings.** DNS binds the domain to this contract, and this
 * contract names the domain back; an entity binds its name to this registrar, and
 * this registrar records the holder; a session binds to the entity that owns it.
 * Every link is two-way and public, so anyone can walk it without asking us.
 *
 * The domain is this contract's own name. It is not registered anywhere and maps to
 * nothing: a name in DNS already belongs to whoever answers for it, and a second
 * register of domains would be a second copy of that fact.
 *
 * **What the domain cannot do.** There is no function here through which the domain
 * can assign, move, rename or take a name. It sets prices and it is paid; a name is
 * claimed by the entity that will hold it. A server that can make a claim succeed
 * can also make it fail, and nobody should live at its pleasure.
 *
 * A name leaves its holder in only three ways, and the domain compels none of them:
 * it lapses (expiry, then grace), its holder RELEASES it, or its holder REASSIGNS it
 * straight to a successor. The last two are the holder's own act — the voluntary
 * side of lapsing, so a holder retiring a contract need not wait out a year of grace
 * — and each is gated on `msg.sender` being the current holder, never the domain.
 */
contract DomainContract is IdentityContract {
    // ── errors (custom errors: a 4-byte selector, not an embedded string) ──
    error DomainRequired();
    error NameReserved();
    error NameIsHeld();
    error CallerAlreadyHoldsAName();
    error RenewalFeeRequired();
    error FreeTermTakesNoPayment();
    error NothingToRenew();
    error NameNotHeld();
    error NameHasLapsed();
    error WrongAmount();
    error NotTheHolder();
    error NewHolderRequired();
    error NewHolderAlreadyHoldsAName();
    error HolderAlreadyHoldsAName();
    error HolderDoesNotAssertThisName();
    error NothingBilled();
    error NoCharges();
    error ZeroCharge();
    error ChargesValue();
    error NotANumber();
    error NameLength();
    error NameCharacters();


    // ── the domain ─────────────────────────────────────────────────────────
    string public domain;                       // bound by DNS; written once, at construction

    // ── the names it issues ────────────────────────────────────────────────
    //
    // A name is rented. A short free term comes with the claim — enough to prove
    // real intent (pay, or let it go) without a long free squat — and each renewal
    // then buys a full year FROM THE CURRENT EXPIRY, so paying late buys no extra
    // time. Once the grace period after expiry has passed the name is available
    // again — no transaction releases it, the next claim takes it.
    struct NameRecord { address holder; uint64 expiresAt; }

    // Renewal and grace stay fixed: a paid year is a year, and a lapse always keeps
    // its holder through a year of grace. Names already claimed keep the expiry they
    // were given; a change to the free term applies only to later claims.
    uint64 public constant TERM  = 365 days;    // what one paid year buys (renewals)
    uint64 public constant GRACE = 365 days;    // how long a lapsed name is still its holder's

    mapping(string => NameRecord) private _names;   // name => record
    mapping(address => string) private _held;       // holder => the one name it holds

    // ── config lives in the core's attribute store, not in bespoke maps ─────
    //
    // The domain's PRICES, its FREE TERM and its RESERVED names are all just named
    // values a rivet sets and anyone reads — exactly what {EpisteryAccess}'s public
    // attributes are. So they live there, in two sections, rather than in private
    // mappings this contract would re-implement (along with their enumeration and a
    // swap-and-pop the ACL already has). One mechanism: a domain's settings are its
    // attributes, set with `setPublic` and read with `getPublic`/`getPublicKeys`.
    //
    // Prices are wei as a decimal string. A reserved name carries any non-empty
    // value ("1"); clearing it (value "") returns the name to the open pool — a
    // reserved name is just an attribute whose presence the registrar honours.
    // The free term is a count of DAYS, not wei, so it lives in its own `_policy`
    // section — `_fees`/feeKeys() stay a clean list of wei prices, nothing else.
    string private constant SEC_FEES      = "_fees";
    string private constant SEC_RESERVED  = "_reserved";
    string private constant SEC_POLICY    = "_policy";
    string public  constant FEE_NAME_RENEWAL = "name.renewal";
    string private constant FREE_TERM_DAYS   = "name.freeTermDays";

    // ── events ─────────────────────────────────────────────────────────────
    event DomainBound(string domain, address indexed creator);
    event NameClaimed(string name, address indexed holder, uint64 expiresAt);
    event NameRenewed(string name, address indexed holder, uint64 expiresAt, uint256 paid, address indexed payer);
    event NameReleased(string name, address indexed priorHolder, address indexed newHolder);
    // Prices, free term and reservations are attributes now, so their writes emit
    // the core's PublicSet — no bespoke FeeSet/FreeTermSet/NameReserved events.
    // The domain as biller: every payment for a service it renders is a typed,
    // public, permissionless on-chain record, and the POL is held in this
    // contract's own treasury — no off-chain ledger, no privileged wallet.
    event ServiceBilled(address indexed payer, string service, uint256 amount, uint256 timestamp);

    /**
     * @param firstRivet the domain's first device — its rivets wield it, as an
     *        individual's wield theirs. A signer may be an entity contract.
     * @param domain_ the domain this contract answers for, e.g. "epistery.com".
     *        DNS is the other half of the binding.
     */
    constructor(
        address firstRivet,
        string memory firstRivetName,
        string memory firstRivetPubKey,
        string memory domain_
    ) IdentityContract(firstRivet, firstRivetName, firstRivetPubKey, address(0), "") {
        if (!(bytes(domain_).length > 0)) revert DomainRequired();
        domain = domain_;
        emit DomainBound(domain_, firstRivet);

        // The default free term a new name comes with (days), as an attribute like
        // every other setting. _setPublic seeds it before any external call can.
        _setPublic(SEC_POLICY, FREE_TERM_DAYS, "30");

        // The operational names no domain may let a random hold — RFC 2142 and
        // friends — withheld from the pool as attributes. Seeded here so not one is
        // claimable for a single block; a rivet adds or clears entries later with
        // setPublic(SEC_RESERVED, name, "1" | "").
        _setPublic(SEC_RESERVED, "abuse", "1");
        _setPublic(SEC_RESERVED, "postmaster", "1");
        _setPublic(SEC_RESERVED, "hostmaster", "1");
        _setPublic(SEC_RESERVED, "webmaster", "1");
        _setPublic(SEC_RESERVED, "admin", "1");
        _setPublic(SEC_RESERVED, "support", "1");
        _setPublic(SEC_RESERVED, "security", "1");
        _setPublic(SEC_RESERVED, "noc", "1");
        _setPublic(SEC_RESERVED, "root", "1");
        _setPublic(SEC_RESERVED, "www", "1");
        _setPublic(SEC_RESERVED, "mail", "1");
        _setPublic(SEC_RESERVED, "ftp", "1");
        _setPublic(SEC_RESERVED, "info", "1");
        _setPublic(SEC_RESERVED, "noreply", "1");
    }

    // ── claiming ───────────────────────────────────────────────────────────

    /**
     * Claim `name` for the caller. Called by an entity's constructor, so the mint
     * of an entity whose name is taken reverts as a whole.
     *
     * The caller claims for ITSELF — there is no address argument, and so no way
     * for anyone to place a name on anyone else. Nothing here checks what the
     * caller is: an address with nothing to report back can hold a name, and will
     * never be confirmed, which is the same rule everyone is read by.
     */
    function claim(string calldata name) external payable {
        _requireValidName(name);
        if (_isReserved(name)) revert NameReserved();    // the domain's own names never enter the pool
        NameRecord storage rec = _names[name];
        address prior = rec.holder;
        if (prior != address(0)) {
            if (!(block.timestamp > uint256(rec.expiresAt) + GRACE)) revert NameIsHeld();
            delete _held[prior];
            emit NameReleased(name, prior, msg.sender);
        }
        if (!(bytes(_held[msg.sender]).length == 0)) revert CallerAlreadyHoldsAName();

        // A domain with a free term gives the claim that many days for nothing. A
        // domain that sets the free term to zero has none — the first year must be
        // PAID at the claim, exactly as a renewal is. (So a `name.renewal` of 0 then
        // makes even a no-free-term claim free, the same convention a zero fee
        // carries everywhere — absent and zero are the deliberate "free".)
        uint64 term;
        uint256 ftd = _freeTermDays();
        if (ftd == 0) {
            if (!(msg.value == _feeWei(FEE_NAME_RENEWAL))) revert RenewalFeeRequired();
            term = TERM;
        } else {
            if (!(msg.value == 0)) revert FreeTermTakesNoPayment();
            term = uint64(ftd) * 1 days;
        }

        rec.holder = msg.sender;
        rec.expiresAt = uint64(block.timestamp) + term;
        _held[msg.sender] = name;
        emit NameClaimed(name, msg.sender, rec.expiresAt);
    }

    /**
     * Pay for `years_` more years of `name`, from its current expiry. Anyone may
     * pay: it only ever extends the term of whoever holds the name, so paying for
     * someone else needs no path of its own.
     */
    function renew(string calldata name, uint16 years_) external payable {
        if (!(years_ > 0)) revert NothingToRenew();
        NameRecord storage rec = _names[name];
        if (!(rec.holder != address(0))) revert NameNotHeld();
        if (!(block.timestamp <= uint256(rec.expiresAt) + GRACE)) revert NameHasLapsed();
        if (!(msg.value == _feeWei(FEE_NAME_RENEWAL) * years_)) revert WrongAmount();

        rec.expiresAt += TERM * uint64(years_);           // from the expiry, never from today
        emit NameRenewed(name, rec.holder, rec.expiresAt, msg.value, msg.sender);
    }

    // ── a holder lets go ─────────────────────────────────────────────────────
    //
    // The voluntary other side of lapsing. The domain compels neither: both are
    // gated on the caller BEING the current holder, so a server can no more take a
    // name here than it can through claim. A held contract calls these through its
    // own executeTransaction, so its rivets decide — not the registrar's.

    /**
     * Give up `name`. Only its current holder may, and the name is available again
     * at once — so a holder done with a name (a contract being retired) need not
     * wait out the grace period.
     */
    function release(string calldata name) external {
        if (!(_names[name].holder == msg.sender)) revert NotTheHolder();
        delete _held[msg.sender];
        delete _names[name];
        emit NameReleased(name, msg.sender, address(0));
    }

    /**
     * Hand `name` straight to `newHolder`, keeping its expiry: the holder's own
     * succession in one transaction, with no release-and-reclaim gap and no reset of
     * the term already paid. Only the current holder may, and `newHolder` must not
     * already hold a name (one name per holder, as everywhere here). This is how a
     * name moves onto a freshly minted successor without the registrar ever being
     * reset. The NameClaimed is emitted too, so the relay's name cache — which
     * follows NameClaimed — tracks the successor the same as any claim.
     */
    function reassign(string calldata name, address newHolder) external {
        NameRecord storage rec = _names[name];
        if (!(rec.holder == msg.sender)) revert NotTheHolder();
        if (!(newHolder != address(0))) revert NewHolderRequired();
        if (!(bytes(_held[newHolder]).length == 0)) revert NewHolderAlreadyHoldsAName();
        delete _held[msg.sender];
        rec.holder = newHolder;
        _held[newHolder] = name;
        emit NameReleased(name, msg.sender, newHolder);
        emit NameClaimed(name, newHolder, rec.expiresAt);
    }

    /**
     * Record a binding the domain already owns — the migration path when the
     * domain's contract is redeployed and its names must appear on the new instance.
     * The holder must ITSELF already assert this name under this domain (the same
     * two-way agreement {confirmed} reads), so the domain RATIFIES a consent it can
     * read; it never invents one, and still cannot conjure a name or take one that
     * is live. A rivet's act — the domain is ruled by its rivets, and migrating its
     * own records is its prerogative, not a power over anyone. A fresh paid year is
     * granted on migration: the old term lives on the old contract, and nothing
     * here resets silently.
     */
    function declare(string calldata name, address holder) external onlyRivet {
        _requireValidName(name);
        if (_isReserved(name)) revert NameReserved();
        NameRecord storage rec = _names[name];
        if (!(rec.holder == address(0) || block.timestamp > uint256(rec.expiresAt) + GRACE)) revert NameIsHeld();
        if (!(bytes(_held[holder]).length == 0)) revert HolderAlreadyHoldsAName();
        if (!(holder.code.length > 0 && _entityNameIs(holder, name) && _underThisDomain(holder))) revert HolderDoesNotAssertThisName();
        rec.holder = holder;
        rec.expiresAt = uint64(block.timestamp) + TERM;
        _held[holder] = name;
        emit NameClaimed(name, holder, rec.expiresAt);
    }

    // ── reading (facts, no verdict) ────────────────────────────────────────

    // A reserved name resolves to the domain itself — its signers are who "abuse"
    // or "support" should reach — while an ordinary name resolves to its holder.
    function holderOf(string calldata name) external view returns (address) {
        return _isReserved(name) ? address(this) : _names[name].holder;
    }
    function expiresAt(string calldata name) external view returns (uint64) { return _names[name].expiresAt; }
    function nameOf(address holder) external view returns (string memory) { return _held[holder]; }

    /** When this name stops being its holder's, if nothing more is paid. */
    function graceEndsAt(string calldata name) external view returns (uint64) {
        NameRecord storage rec = _names[name];
        return rec.holder == address(0) ? 0 : rec.expiresAt + GRACE;
    }

    /** True if a claim would succeed: never held, or held and past its grace — and
     *  never for a reserved name, which the pool does not offer. */
    function available(string calldata name) external view returns (bool) {
        if (_isReserved(name)) return false;
        NameRecord storage rec = _names[name];
        return rec.holder == address(0) || block.timestamp > uint256(rec.expiresAt) + GRACE;
    }

    /**
     * The binding, checked in both directions — and bound to the DOMAIN, not to
     * this contract instance. This registrar records the holder; the holder agrees
     * it carries this name AND stands under this domain. Because the domain (its
     * name, rooted in DNS) is the stable identity and this contract is only an
     * instance of it, an identity issued by a PRIOR instance of the same domain
     * still confirms — redeploying the registrar orphans no one. A holder that
     * cannot answer, carries another name, or stands under another domain, is a
     * claim and nothing more.
     */
    function confirmed(string calldata name) external view returns (bool) {
        address holder = _names[name].holder;
        // Nothing to ask: no holder, or an address with no code to answer with.
        // A call to a codeless address succeeds with empty data, which decodes to
        // a revert the caller cannot catch, so this is checked before asking.
        if (holder == address(0) || holder.code.length == 0) return false;
        return _entityNameIs(holder, name) && _underThisDomain(holder);
    }

    // ── prices / free term (typed reads over the attribute store) ──────────
    //
    // Set with the inherited setPublic(SEC_FEES, key, weiString) — a steward (any
    // rivet) or a section admin may, the same gate every attribute carries. Read
    // here as typed values so callers keep a simple interface over the one store.

    /** A price in wei — "name.renewal", "relay.toll", "identity.starter", … — or 0
     *  when the domain records none (an unset attribute reads empty, which is zero). */
    function fee(string calldata key) external view returns (uint256) { return _feeWei(key); }

    /** Every priced key the domain records. */
    function feeKeys() external view returns (string[] memory) { return _getPublicKeys(SEC_FEES); }

    /** The free term a new name comes with, in days (0 = none, pay at the claim). */
    function freeTermDays() external view returns (uint32) { return uint32(_freeTermDays()); }

    // ── reserved names (typed reads over the attribute store) ──────────────
    //
    // Reserve with setPublic(SEC_RESERVED, name, "1"); return a name to the pool
    // with value "". Read here for convenience; claim/holderOf/confirmed use the
    // internal _isReserved.

    /** True if `name` is withheld from the open pool. */
    function isReserved(string calldata name) external view returns (bool) { return _isReserved(name); }

    /** The live reserved set — the keys of SEC_RESERVED whose value is non-empty (a
     *  cleared reservation leaves an empty-valued key behind, so it is filtered). */
    function reservedNames() external view returns (string[] memory names) {
        string[] memory keys = _getPublicKeys(SEC_RESERVED);
        uint256 n;
        for (uint256 i; i < keys.length; i++) {
            if (bytes(_getPublic(SEC_RESERVED, keys[i])).length != 0) n++;
        }
        names = new string[](n);
        uint256 j;
        for (uint256 i; i < keys.length; i++) {
            if (bytes(_getPublic(SEC_RESERVED, keys[i])).length != 0) names[j++] = keys[i];
        }
    }

    // ── the domain as biller (treasury intake) ─────────────────────────────
    //
    // The domain collects for the services it renders — a relay toll, resold
    // storage or chat — into its OWN treasury, and records each as a typed public
    // event. No off-chain ledger holds the truth and no privileged wallet sits in
    // the middle: `bill` holds the POL (this contract already being a treasury via
    // {IdentityContract}) and emits the receipt, which anyone can read and total.
    // `msg.sender` is the payer, routed through the payer's own executeTransaction,
    // so it is self-proving. The contract records; it does not gate — the service's
    // own gate already decided whether to render it. The domain's signers withdraw
    // or spend the treasury through the inherited onlyRivet `sendETH`/`executeTransaction`.

    struct Charge { string service; uint256 amount; }

    /** Pay the domain for one service rendered (e.g. a relay toll). */
    function bill(string calldata service) external payable {
        if (!(msg.value > 0)) revert NothingBilled();
        emit ServiceBilled(msg.sender, service, msg.value, block.timestamp);
    }

    /** Pay for several services in one transaction — a settled batch of storage and
     *  chat usage — each a typed line. The lines must sum to the value sent, so the
     *  on-chain record is exact and self-checking. */
    function billBatch(Charge[] calldata charges) external payable {
        if (!(charges.length > 0)) revert NoCharges();
        uint256 sum;
        for (uint256 i; i < charges.length; i++) {
            if (!(charges[i].amount > 0)) revert ZeroCharge();
            emit ServiceBilled(msg.sender, charges[i].service, charges[i].amount, block.timestamp);
            sum += charges[i].amount;
        }
        if (!(sum == msg.value)) revert ChargesValue();
    }

    // ── internals ──────────────────────────────────────────────────────────

    /** A reserved name is an attribute of SEC_RESERVED with a non-empty value. */
    function _isReserved(string calldata name) private view returns (bool) {
        return bytes(_getPublic(SEC_RESERVED, name)).length != 0;
    }

    /** A price, read from SEC_RESERVED's sibling SEC_FEES and parsed from its
     *  decimal-string wei value (unset reads empty → 0). */
    function _feeWei(string memory key) private view returns (uint256) {
        return _toUint(_getPublic(SEC_FEES, key));
    }

    /** The free-term setting, in days (unset → 0). */
    function _freeTermDays() private view returns (uint256) {
        return _toUint(_getPublic(SEC_POLICY, FREE_TERM_DAYS));
    }

    /** Parse a decimal string to a uint256. Empty is 0; a non-digit reverts — a
     *  malformed price is operator error, not a silent zero. */
    function _toUint(string memory s) private pure returns (uint256 n) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (!(c >= 0x30 && c <= 0x39)) revert NotANumber();
            n = n * 10 + (c - 0x30);
        }
    }

    /** The holder agrees it carries `name` — a forward or current identity via
     *  entityName(), a pre-registrar entity via profileName(). */
    function _entityNameIs(address holder, string calldata name) private view returns (bool) {
        bytes32 want = keccak256(bytes(name));
        try INamedEntity(holder).entityName() returns (string memory n) {
            return keccak256(bytes(n)) == want;
        } catch {
            try ILegacyNamedEntity(holder).profileName() returns (string memory n) {
                return keccak256(bytes(n)) == want;
            } catch { return false; }
        }
    }

    /** The holder stands under THIS domain. A forward identity names the domain
     *  directly; a current identity names a registrar CONTRACT, read through to the
     *  domain it answers for (so any instance of this domain — a redeploy, a prior
     *  one — confirms); a pre-registrar entity names neither, and its holder-record
     *  plus the name it publishes (checked by the caller) are all it has. */
    function _underThisDomain(address holder) private view returns (bool) {
        try IDomainNamed(holder).domainName() returns (string memory dn) {
            return _sameDomain(dn);
        } catch {
            try INamedEntity(holder).registrar() returns (address r) {
                if (r == address(this)) return true;
                if (r == address(0) || r.code.length == 0) return false;
                try IRegistrarDomain(r).domain() returns (string memory d) { return _sameDomain(d); }
                catch { return false; }
            } catch {
                return true;   // legacy pre-registrar: it names neither
            }
        }
    }

    function _sameDomain(string memory d) private view returns (bool) {
        return keccak256(bytes(d)) == keccak256(bytes(domain));
    }

    /** Lowercase a-z, 0-9, hyphen and underscore, 1..32 characters. One spelling
     *  per name: a name that differs only by case is the same name, so only one
     *  form is accepted rather than folded silently. */
    function _requireValidName(string calldata name) private pure {
        bytes calldata b = bytes(name);
        if (!(b.length > 0 && b.length <= 32)) revert NameLength();
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a)      // a-z
                   || (c >= 0x30 && c <= 0x39)      // 0-9
                   || c == 0x2d || c == 0x5f;       // - _
            if (!(ok)) revert NameCharacters();
        }
    }
}
