# Security and privacy

## Reporting

Please report security or privacy problems **privately**, using GitHub's
*Report a vulnerability* button on this repository's **Security** tab. Do not open a public issue.

Examples: a way for one athlete's session to read another's files or Garmin account; credentials or
tokens written anywhere in the repository; personal data that the leak scan misses; a way to write to
a watch without the athlete's confirmation.

We will acknowledge a report as soon as we can and fix confirmed problems as a priority. This is a
volunteer project with no bug bounty.

## What the project promises

- Credentials are never stored in the repository. Garmin tokens live in `~/.garminconnect-<name>`,
  created by the user's own interactive login.
- Athletes' folders (`athletes/`, `data/`) are ignored by git; `scripts/leak_scan.py` runs before every
  commit.
- Every Garmin write needs the athlete's explicit confirmation, after a validation gate and the full
  test suite.

## What you are responsible for

Your computer's security, your accounts, and what you send to your AI provider. Never commit your
`athletes/` or `data/` folders to a public repository. See [`DISCLAIMER.md`](DISCLAIMER.md).
