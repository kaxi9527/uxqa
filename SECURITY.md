# Security policy

Security fixes target the latest published version. Upgrade before reproducing a
problem when possible. Do not publish credentials or private evidence in an issue.

Report vulnerabilities privately using GitHub's **Security → Report a vulnerability**
for this repository. Include affected version, OS, minimal reproduction and impact,
using synthetic credentials/data. Do not attach your UXQA data directory.

Relevant boundaries: localhost-only/token-authenticated console and model API,
provider authorization state, private account storage, download validation, selected
project writes and reports that may contain private page data. See
[local data and permissions](docs/local-data-and-permissions.md).

No response-time guarantee is offered. A public issue is suitable for a non-sensitive
bug; suspected credential leaks should be reported privately and the affected
credential revoked with its provider.
