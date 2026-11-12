// DomainContract — a domain as a legal entity, and the registrar of its names.
//
// What is worth proving here is the shape of the thing, not the arithmetic: a
// name is claimed BY the entity that will hold it (so the mint of a taken name
// fails as a whole), the domain has no way to place or take one, a renewal buys a
// year from the EXPIRY rather than from the day it is paid, and a lapsed name
// stays its holder's through the grace period and then belongs to nobody.
//
//   npx hardhat test test/DomainContract.js

const assert = require('node:assert/strict');
const { ethers } = require('hardhat');

const DAY = 24 * 60 * 60;
const YEAR = 365 * DAY;
const PUB = '0x04' + 'ab'.repeat(64);

async function expectRevert(promise, fragment) {
  try { await promise; } catch (e) {
    const m = (e.message || '').toLowerCase();
    assert.ok(m.includes(fragment.toLowerCase()), `expected "${fragment}", got: ${e.message}`);
    return;
  }
  assert.fail(`expected revert containing "${fragment}"`);
}
const travel = async (seconds) => {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine', []);
};

describe('DomainContract', function () {
  let owner, other, payer, Domain, Identity, domain;

  beforeEach(async function () {
    [owner, other, payer] = await ethers.getSigners();
    Domain = await ethers.getContractFactory('DomainContract');
    Identity = await ethers.getContractFactory('IdentityContract');
    domain = await Domain.deploy(owner.address, 'laptop', PUB, 'epistery.com');
    await domain.deployed();
  });

  const mint = (name, signer = owner) =>
    Identity.connect(signer).deploy(signer.address, 'laptop', PUB, domain.address, name);

  describe('the domain itself', function () {
    it('is bound to its domain and carries no name of its own', async function () {
      assert.equal(await domain.domain(), 'epistery.com');
      assert.equal(await domain.entityName(), '');
      assert.equal(await domain.registrar(), ethers.constants.AddressZero);
      assert.equal(await domain.isRivet(owner.address), true);
    });
  });

  describe('claiming', function () {
    it('an entity claims its name as it is minted, and both sides agree', async function () {
      const id = await mint('mjs');
      await id.deployed();
      assert.equal(await domain.holderOf('mjs'), id.address);
      assert.equal(await domain.nameOf(id.address), 'mjs');
      assert.equal(await id.entityName(), 'mjs');
      assert.equal(await id.registrar(), domain.address);
      assert.equal(await domain.confirmed('mjs'), true);
      assert.equal(await domain.available('mjs'), false);
    });

    it('the free term (30 days by default) comes with the claim', async function () {
      const id = await mint('mjs'); await id.deployed();
      const now = (await ethers.provider.getBlock('latest')).timestamp;
      const expires = (await domain.expiresAt('mjs')).toNumber();
      assert.equal(await domain.freeTermDays(), 30);
      assert.ok(Math.abs(expires - (now + 30 * DAY)) <= 5, `expiry ${expires} ≈ now + 30 days`);
      assert.equal((await domain.graceEndsAt('mjs')).toNumber(), expires + YEAR);   // grace is still a year
    });

    it('a rivet sets the free term, in days, for later claims', async function () {
      await domain.setFreeTermDays(90);
      assert.equal(await domain.freeTermDays(), 90);
      const id = await mint('mjs'); await id.deployed();
      const now = (await ethers.provider.getBlock('latest')).timestamp;
      const expires = (await domain.expiresAt('mjs')).toNumber();
      assert.ok(Math.abs(expires - (now + 90 * DAY)) <= 5, 'a later claim uses the new term');
      await expectRevert(domain.connect(other).setFreeTermDays(5), 'not an active rivet');
    });

    it('a free-term claim takes no payment', async function () {
      await expectRevert(domain.connect(other).claim('x', { value: 1 }), 'free term takes no payment');
    });

    it('with the free term set to zero, the claim must pay the first year', async function () {
      const price = ethers.utils.parseEther('50');
      await domain.setFee('name.renewal', price);
      await domain.setFreeTermDays(0);
      await expectRevert(domain.connect(other).claim('paid'), 'renewal fee required');
      await domain.connect(other).claim('paid', { value: price });
      const now = (await ethers.provider.getBlock('latest')).timestamp;
      const expires = (await domain.expiresAt('paid')).toNumber();
      assert.ok(Math.abs(expires - (now + YEAR)) <= 5, 'a paid claim buys a full year');
    });

    it('a mint whose name is taken reverts as a whole', async function () {
      await (await mint('mjs')).deployed();
      await expectRevert(mint('mjs', other), 'name is held');
    });

    it('an entity may carry no name', async function () {
      const id = await Identity.deploy(owner.address, 'laptop', PUB, ethers.constants.AddressZero, '');
      await id.deployed();
      assert.equal(await id.entityName(), '');
      assert.equal(await id.registrar(), ethers.constants.AddressZero);
    });

    it('a name needs a registrar, and a registrar needs a name', async function () {
      await expectRevert(Identity.deploy(owner.address, 'l', PUB, ethers.constants.AddressZero, 'mjs'), 'name needs a registrar');
      await expectRevert(Identity.deploy(owner.address, 'l', PUB, domain.address, ''), 'name needs a registrar');
    });

    it('holds one name per holder', async function () {
      await domain.connect(other).claim('first');
      await expectRevert(domain.connect(other).claim('second'), 'already holds a name');
      assert.equal(await domain.nameOf(other.address), 'first');
    });

    it('takes one spelling of a name, and nothing else', async function () {
      for (const bad of ['MJS', 'mjs.', 'mjs ', 'm@js', '', 'x'.repeat(33)]) {
        await expectRevert(domain.claim(bad), bad.length > 32 || bad.length === 0 ? 'name length' : 'name characters');
      }
    });

    it('an address with nothing to report back can claim, and is never confirmed', async function () {
      await domain.connect(other).claim('someone');
      assert.equal(await domain.holderOf('someone'), other.address);
      assert.equal(await domain.confirmed('someone'), false);
    });

    it('an identity from before the registrar claims, and confirms on its own name', async function () {
      const Legacy = await ethers.getContractFactory('LegacyNamedEntity');
      const legacy = await Legacy.deploy('mjs'); await legacy.deployed();
      await legacy.claim(domain.address, 'mjs');                   // as executeTransaction would
      assert.equal(await domain.holderOf('mjs'), legacy.address);
      assert.equal(await domain.confirmed('mjs'), true);           // no re-mint, no rename
    });

    it('an older identity publishing a different name does not confirm', async function () {
      const Legacy = await ethers.getContractFactory('LegacyNamedEntity');
      const legacy = await Legacy.deploy('someone-else'); await legacy.deployed();
      await legacy.claim(domain.address, 'mjs');
      assert.equal(await domain.confirmed('mjs'), false);
    });

    it('an entity carrying another name does not confirm', async function () {
      const id = await mint('mjs'); await id.deployed();
      await domain.connect(other).claim('rootz');          // claimed by an EOA, not that entity
      assert.equal(await domain.confirmed('rootz'), false);
    });
  });

  describe('renting', function () {
    const price = ethers.utils.parseEther('50');

    beforeEach(async function () { await domain.setFreeTermDays(365); await domain.setFee('name.renewal', price); });

    it('charges the price the registrar holds', async function () {
      const id = await mint('mjs'); await id.deployed();
      await expectRevert(domain.renew('mjs', 1, { value: price.sub(1) }), 'wrong amount');
      await expectRevert(domain.renew('mjs', 2, { value: price }), 'wrong amount');
      const before = (await domain.expiresAt('mjs')).toNumber();
      await domain.renew('mjs', 2, { value: price.mul(2) });
      assert.equal((await domain.expiresAt('mjs')).toNumber(), before + 2 * YEAR);
    });

    it('is paid to the domain, and anyone may pay', async function () {
      const id = await mint('mjs'); await id.deployed();
      const before = await ethers.provider.getBalance(domain.address);
      await domain.connect(payer).renew('mjs', 1, { value: price });
      assert.equal((await ethers.provider.getBalance(domain.address)).sub(before).toString(), price.toString());
    });

    it('buys a year from the expiry, so paying late buys no extra time', async function () {
      const id = await mint('mjs'); await id.deployed();
      const expiry = (await domain.expiresAt('mjs')).toNumber();
      await travel(YEAR + 200 * 24 * 60 * 60);                       // 200 days into the grace period
      await domain.renew('mjs', 1, { value: price });
      assert.equal((await domain.expiresAt('mjs')).toNumber(), expiry + YEAR);
    });

    it('a price change leaves a term already paid alone', async function () {
      const id = await mint('mjs'); await id.deployed();
      await domain.renew('mjs', 1, { value: price });
      const paid = (await domain.expiresAt('mjs')).toNumber();
      await domain.setFee('name.renewal', ethers.utils.parseEther('80'));
      assert.equal((await domain.expiresAt('mjs')).toNumber(), paid);
      await expectRevert(domain.renew('mjs', 1, { value: price }), 'wrong amount');
    });
  });

  describe('lapsing', function () {
    // Renewal/grace timing is year-based; give the claim a year's term so the
    // travels land where these assertions expect.
    beforeEach(async function () { await domain.setFreeTermDays(365); });

    it('stays with its holder through the grace period, then belongs to nobody', async function () {
      const id = await mint('mjs'); await id.deployed();
      await travel(YEAR + 10);                                       // expired, in grace
      assert.equal(await domain.available('mjs'), false);
      await expectRevert(mint('mjs', other), 'name is held');

      await travel(YEAR);                                            // grace over
      assert.equal(await domain.available('mjs'), true);
      const next = await mint('mjs', other); await next.deployed();
      assert.equal(await domain.holderOf('mjs'), next.address);
      assert.equal(await domain.nameOf(id.address), '');             // the prior holder's claim is cleared
    });

    it('a lapse takes the name and nothing else', async function () {
      const id = await mint('mjs'); await id.deployed();
      await travel(2 * YEAR + 10);
      const next = await mint('mjs', other); await next.deployed();
      assert.equal(await id.entityName(), 'mjs');                    // it still says what it was called
      assert.equal(await domain.holderOf('mjs'), next.address);      // but the registrar names another holder
      assert.equal(await domain.nameOf(id.address), '');             // so its own claim confirms nothing
      assert.equal(await id.isRivet(owner.address), true);           // its members are untouched
    });

    it('cannot be renewed once it has lapsed', async function () {
      const id = await mint('mjs'); await id.deployed();
      await domain.setFee('name.renewal', ethers.utils.parseEther('50'));
      await travel(2 * YEAR + 10);
      await expectRevert(domain.renew('mjs', 1, { value: ethers.utils.parseEther('50') }), 'has lapsed');
    });
  });

  describe('prices', function () {
    it('are set by a rivet and read by anyone', async function () {
      await domain.setFee('relay.toll', ethers.utils.parseEther('0.1'));
      await domain.setFee('identity.starter', ethers.utils.parseEther('5'));
      assert.equal((await domain.fee('relay.toll')).toString(), ethers.utils.parseEther('0.1').toString());
      assert.deepEqual([...(await domain.feeKeys())], ['relay.toll', 'identity.starter']);
      await expectRevert(domain.connect(other).setFee('relay.toll', 1), 'not an active rivet');
    });
  });

  describe('what the domain cannot do', function () {
    it('has no way to assign, move, rename or take a name', async function () {
      const abi = Domain.interface.fragments.filter((f) => f.type === 'function').map((f) => f.name);
      for (const forbidden of ['setAddressName', 'assignName', 'transferName', 'setName', 'takeName']) {
        assert.ok(!abi.includes(forbidden), `${forbidden} should not exist`);
      }
      // claim takes no address: a caller can only ever claim for itself
      const claim = Domain.interface.fragments.find((f) => f.name === 'claim');
      assert.deepEqual(claim.inputs.map((i) => i.type), ['string']);
    });

    it('a domain rivet cannot release or move a name it does not hold', async function () {
      const id = await mint('mjs'); await id.deployed();                           // held by the entity
      await expectRevert(domain.release('mjs'), 'not the holder');                 // owner IS a domain rivet
      await expectRevert(domain.reassign('mjs', other.address), 'not the holder');
      assert.equal(await domain.holderOf('mjs'), id.address);                      // unmoved
    });
  });

  describe('a holder lets go', function () {
    it('releases its own name, available at once — no waiting out grace', async function () {
      await domain.connect(other).claim('spare');
      assert.equal(await domain.available('spare'), false);
      await expectRevert(domain.connect(payer).release('spare'), 'not the holder');
      await domain.connect(other).release('spare');
      assert.equal(await domain.available('spare'), true);
      assert.equal(await domain.holderOf('spare'), ethers.constants.AddressZero);
      assert.equal(await domain.nameOf(other.address), '');
      await domain.connect(other).claim('spare');                                  // the freed slot is claimable
      assert.equal(await domain.holderOf('spare'), other.address);
    });

    it('hands its name to a successor in one tx, keeping the expiry', async function () {
      await domain.setFreeTermDays(365);
      await domain.connect(other).claim('mjs');
      const expiry = (await domain.expiresAt('mjs')).toNumber();
      await expectRevert(domain.connect(payer).reassign('mjs', payer.address), 'not the holder');
      await domain.connect(other).reassign('mjs', payer.address);
      assert.equal(await domain.holderOf('mjs'), payer.address);
      assert.equal(await domain.nameOf(payer.address), 'mjs');
      assert.equal(await domain.nameOf(other.address), '');
      assert.equal((await domain.expiresAt('mjs')).toNumber(), expiry);            // term carried over, not reset
    });

    it('cannot hand a name to someone who already holds one, or to nobody', async function () {
      await domain.connect(other).claim('a');
      await domain.connect(payer).claim('b');
      await expectRevert(domain.connect(other).reassign('a', payer.address), 'already holds a name');
      await expectRevert(domain.connect(other).reassign('a', ethers.constants.AddressZero), 'newHolder required');
    });
  });
});
