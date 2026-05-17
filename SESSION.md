1# Epistery CLI Session Log
## Date: 2025-10-14

### Context
Building epistery CLI for authenticated requests to wiki.rootz.global. Hours of work building authentication system. Machine has crashed multiple times, losing session context.

### Current State
- **CLI Location**: `./cli/epistery.mjs`
- **Identity**: localhost wallet at `~/.epistery/localhost/config.ini`
- **Address**: `0x8df97495e72461786E263CaECcAf21315E98e9aF`
- **Default Domain**: Set to `localhost`
- **Authorization**: This address is authorized on wiki.rootz.global server
- **Recent Change**: Bot mode now defaults to `true` (was `false`) in cli/epistery.mjs line 127

### Goal
Post documentation to https://wiki.rootz.global/wiki/Home explaining how other developers can:
1. Set up epistery CLI
2. Configure authentication
3. Post to the wiki from their dev environment using Claude

### Current Issue
- ✅ Read works: `epistery curl https://wiki.rootz.global/wiki/Home`
- ❌ Write getting unauthorized (was working before crash)

### Commands That Work
```bash
epistery set-default localhost
epistery curl https://wiki.rootz.global/wiki/Home
```

### Debugging Progress

**Bot Mode (Authorization header):**
- ✅ Signature generation works
- ❌ Server returns 401 Unauthorized
- Format: `Authorization: Bot <base64 JSON with address, signature, message>`

**Session Mode (Key Exchange):**
- ✅ Key exchange completes successfully
- ✅ Server responds: 0x06E2174095fB7cb1251EEf4D229772A59a0C8761
- ❌ Returns `authenticated: false`
- ❌ No session cookie set by server
- This means the server doesn't recognize/trust the client address (9aF)

### Solution Found

The bot authentication in Rhonda's account-server (lines 825-909) expects:
1. User exists in database ✅
2. ACL exists for account access ✅
3. Signature verification ✅

The user needs to be marked as a system account. Update MongoDB:
```
db.user.updateOne(
  {_id: '0x8df97495e72461786E263CaECcAf21315E98e9aF'},
  {$set: {'options.systemAccount': true}}
)
```

### Next Steps
1. Update user record to mark as system account
2. Test bot authentication with CLI
3. Write and post developer documentation to wiki

### Resolution

**Fixed in `/home/msprague/workspace/rootz/rhonda/modules/account-server/index.mjs:866`**

Changed from:
```javascript
const userAccount = await this.userCollection.findOne({
  address: address.toLowerCase()
});
```

To:
```javascript
const userAccount = await this.userCollection.findOne({
  address: new RegExp(`^${address}$`, 'i')
});
```

This makes address lookup case-insensitive, handling addresses stored with mixed case in the database.

### Success

✅ Bot authentication working
✅ Test page created at `/wiki/ClaudeTest`
✅ Documentation updated on wiki Home page
✅ Other developers can now follow the instructions to set up their own agents

### Key Learnings

1. **Case sensitivity**: Ethereum addresses are case-insensitive but often stored with mixed case (checksummed). Always use case-insensitive comparison in MongoDB queries.

2. **Bot authentication flow**: The Epistery CLI signs each request with the wallet's private key. The server verifies the signature, looks up the user by address, checks ACL permissions, and allows/denies the request.

3. **Session persistence**: Creating SESSION.md files for important development sessions helps recover from machine crashes and provides documentation of debugging processes.