# Plug in architecture

This module is a plugin. It provides a host with native services and features exposed through
host.tld/.epistery. The .epistery routes should be mostly web api's, not presentation. The
root. The root provides a manifest of identity attributes and capabilities. The sub routes
represent controllers providing the core services, primarily data wallets.

## Structure
This is a typescript project

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
| /src/cli               | Command line services for configuration, registration and status                                                 |
| /src/cli/index.ts      | App harness to execute commands                                                                                  |
| /src/cli/certify.ts    | Provides domain name SSL certs via acme.                                                                         |
| /src/cie/initialize.ts | Query for profile data. Mint the server's wallet and populate config.ini                                         |                                                                                
| /test                  | A barebones host application to provide sample code and exercise the features                                    |
| /default.ini           | template configuration for initialising a new installation                                                       |

>NOTE: api.ts is left out. I propose that if we want a standalone generic implementation of the epistery plugin,
> it should implemented in a separate repo.

## Data Wallets
The core purpose of the epistery plugin is manage the creation and manipulation of data wallets. This manifests as api's
invoked by the browser and partner sites

## SSL
A host needn't use the SSL tools offered by epistery. Certification is made available for convenience and the opportunity to more
closely bind the infrastructure that connects legal identities to digital identities. SSL certs are a respected means to
distinguish the legal posture of services provided through the web, but SSL just provides transport encryption. Data wallets
and the blockchain keying infrastructure it provides extends that model with significant new agency.