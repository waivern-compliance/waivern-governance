# Security policy

The Waivern Governance Tool holds records about personal data and the decisions made about it, so we take reports about its security seriously.

## Reporting a vulnerability

Please don't open a public issue. Report it privately, either:

- through GitHub: **Security → Report a vulnerability** on this repository, or
- by email to [info@waivern.com](mailto:info@waivern.com), with "Security" in the subject.

Include what you found, how to reproduce it, and the impact you think it has. We will acknowledge your report within five working days, keep you updated while we fix it, and credit you when the fix is released, unless you'd rather we didn't.

## Supported versions

Fixes are made on `main`. If you run your own deployment, keep it up to date with `main` to receive them.

## Scope

In scope: this repository's code, including tenant isolation, access control, the audit chain, the integration API and file uploads.

Out of scope: weaknesses in a particular deployment's configuration or hosting, which are for whoever runs that deployment. Reports about Waivern's own hosted service are welcome at the same address.
