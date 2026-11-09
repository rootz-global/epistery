// IdentityContract — rivet set integrity across remove + re-add.
//
// Regression for the append-only bug: removeRivet left the address in the
// authorizedRivets array, so re-adding the SAME address pushed a duplicate and
// getRivets() (a rivetCount-sized buffer filled by looping the whole array)
// wrote out of bounds and reverted — bricking every read of the identity's
// signers. The fix keeps authorizedRivets compacted to exactly the active set
// (swap-and-pop), the same shape EpisteryAccess's ACL already uses.
//
//   npx hardhat test test/IdentityRivets.js

const assert = require('node:assert/strict');
const { ethers } = require('hardhat');

async function expectRevert(promise, fragment) {
  try { await promise; } catch (e) {
    const m = (e.message || '').toLowerCase();
    assert.ok(m.includes(fragment.toLowerCase()), `expected "${fragment}", got: ${e.message}`);
    return;
  }
  assert.fail(`expected revert containing "${fragment}"`);
}

const set = (addrs) => new Set(addrs.map((a) => a.toLowerCase()));

describe('IdentityContract rivets', function () {
  let owner, a, b, c, Identity, id;

  beforeEach(async function () {
    [owner, a, b, c] = await ethers.getSigners();
    Identity = await ethers.getContractFactory('IdentityContract');
    // No name/registrar: a nameless entity (registrar = 0, name = "").
    id = await Identity.deploy(owner.address, 'device', '', ethers.constants.AddressZero, '');
    await id.deployed();
  });

  it('starts with the first rivet', async function () {
    assert.equal((await id.rivetCount()).toString(), '1');
    assert.deepEqual(set(await id.getRivets()), set([owner.address]));
  });

  it('adds and lists rivets', async function () {
    await (await id.addRivet(a.address, 'phone')).wait();
    await (await id.addRivet(b.address, 'laptop')).wait();
    assert.equal((await id.rivetCount()).toString(), '3');
    assert.deepEqual(set(await id.getRivets()), set([owner.address, a.address, b.address]));
  });

  it('removing then re-adding the SAME address keeps getRivets working (the bug)', async function () {
    await (await id.addRivet(a.address, 'phone')).wait();        // owner, a
    await (await id.removeRivet(a.address)).wait();              // owner
    assert.deepEqual(set(await id.getRivets()), set([owner.address]));
    await (await id.addRivet(a.address, 'phone-again')).wait();  // owner, a  (re-add same addr)

    // On the old code getRivets() reverted here (duplicate in the array).
    assert.equal((await id.rivetCount()).toString(), '2');
    assert.deepEqual(set(await id.getRivets()), set([owner.address, a.address]));
    assert.equal(await id.isRivet(a.address), true);
  });

  it('swap-and-pop keeps the set correct when removing a middle rivet', async function () {
    await (await id.addRivet(a.address, 'a')).wait();
    await (await id.addRivet(b.address, 'b')).wait();
    await (await id.addRivet(c.address, 'c')).wait();            // owner, a, b, c
    await (await id.removeRivet(b.address)).wait();              // remove middle
    assert.equal((await id.rivetCount()).toString(), '3');
    assert.deepEqual(set(await id.getRivets()), set([owner.address, a.address, c.address]));
    assert.equal(await id.isRivet(b.address), false);
    // c (swapped into b's slot) is still intact and removable
    await (await id.removeRivet(c.address)).wait();
    assert.deepEqual(set(await id.getRivets()), set([owner.address, a.address]));
  });

  it('cannot remove the last rivet', async function () {
    await expectRevert(id.removeRivet(owner.address), 'cannot remove last rivet');
  });
});
