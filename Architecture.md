# Plug in architecture

This module is a plugin. It provides a host with data-wallet services exposed through
host.tld/.well-known/epistery. Epistery will create wallets for both the client (browser)
and the server if not otherwise provided. It provides the foundation methods for creating,
validating and manipulating data-wallets.

Server code is available through web calls. The
client is implemented with a browser script available from client.js.

## Structure
This is a typescript project build on express.

| path                   | description                                                                                                      |
|------------------------|------------------------------------------------------------------------------------------------------------------|
| /index.mjs             | Entry point harness                                                                                              |
| /client                | Assets and scripts intended to be embedded in the browser page                                                   |
| /client/client.js      | client-side counterpart to /epistery.ts.                                                                         |
| /client/ethers.js      | Core blockchain tools                                                                                            |
| /client/status.html    | The template page rendered by /.epistery/status. This is the only human readable content presented by /.epistery |
| /client/witness.js     |                                                                                                                  |
| /src                   | implementation                                                                                                   |
| /src/controllers/      | Controllers provide discreet services usually behind a named route /.epistery/[controller]                       |
| /src/utils             | Shared tools that assist the controllers                                                                         |
| /src/utils/Aqua.ts     | Aqua protocol implementation that underlies the data wallet implementation                                       |
| /src/utils/Config.ts   | Interface to the $HOME/.epistory/config.ini and dependent configuration data                                     |
| /src/utils/types.ts    | Typescript common schema                                                                                         |
| /src/utils/Utils.ts    | (Not sure. Seems like these methods should be attached to something with a named purpose                         |
| /src/utils/index.ts    | Import root for reach all utilities                                                                              |
| /src/epistery.ts       | Root class that is connected by the host                                                                         |
| /test                  | A barebones host application to provide sample code and exercise the features                                    |
| /default.ini           | template configuration for initialising a new installation                                                       |

>NOTE: api.ts is left out. I propose that if we want a standalone generic implementation of the epistery plugin,
> it should be implemented in a separate repo.

## Data Wallets
The core purpose of the epistery plugin is manage the creation and manipulation of data wallets. This manifests as api's
invoked by the browser and partner sites

All of the Data Wallet functionality is found in the in /src/controllers/DataWalletController, operating behind .epistery/data. Utils
is used for common cryto functionaility and other tools

## Signing Wallets

## Config File
System configuration is managed with ini files in $HOME/.epistery. THe root defines config.ini which has system wide
settings. The default settings are captured in default.ini. Each domain that has been initialized will have a folder
with it's own config.ini file, as well as key files and other persistent settings.

The root config file is structured into the following sections

```ini
[profile]
  name=
  email=
[ipfs]
 url=https://rootz.digital/api/v0
[defaultDomainConfig.provider]
// When a domain is initialized, it defaults to this provide info which is subsequencly saved with the domain config.ini
 chainId=
 name=
 rpc=
```

A domain config file, like `$HOME/.epistery/mydomain.com/config.ini`, includes:

```ini
[provider]
chainId=
name=
rpc=

[wallet]
address=
mnemonic=
publicKey=
privateKey=

[ssl]
key=
cert=
modified=
```
