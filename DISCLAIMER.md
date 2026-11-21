# Disclaimer — read this before you use OpenSportCoach

Version: 2026-11-21

OpenSportCoach is free, open-source software. It uses an AI model to read your training data and
suggest training. By using it you agree to everything below. If you do not agree, do not use it.

## Not medical advice

- OpenSportCoach is **not a doctor, physiotherapist, dietitian or qualified coach**, and nothing it
  produces — plans, workouts, recovery calls, fuelling or race advice, analyses — is medical,
  nutritional or professional advice.
- **Talk to a doctor before you start or change a training programme**, especially if you have a
  heart condition, high blood pressure, diabetes or another long-term condition, an injury, are
  pregnant, take medication, or have not trained in a while.
- **Stop immediately** and get medical help if you feel chest pain, faintness, dizziness, unusual
  breathlessness or pain. In an emergency, call your local emergency number.
- OpenSportCoach is for **adults (18 or older)** only.

## AI can be wrong

The plans and analyses come from a large language model and from formulas applied to data from your
devices. Models make mistakes, devices record wrong values, and formulas have limits. A suggestion
can be unsafe for you even when it looks reasonable. **You are responsible for deciding what you do.**
Check anything that matters with a qualified professional.

## Use at your own risk

You train at your own risk. To the maximum extent permitted by law, the authors and contributors of
OpenSportCoach accept **no responsibility or liability** for any injury, illness, death, damage, data
loss, account suspension or any other loss that results from using it, from following or not
following its suggestions, or from any error in it.

The software is provided **"AS IS", without warranties or conditions of any kind**, as set out in
the [Apache License 2.0](LICENSE), Sections 7 (Disclaimer of Warranty) and 8 (Limitation of
Liability), which apply in full.

## Third-party services

- OpenSportCoach is **not affiliated with, endorsed by or sponsored by** Garmin, Strava, Anthropic,
  Zwift or any other company or event named in it. Their names are used only to say what this
  software works with. All trademarks belong to their owners.
- The Garmin integration uses [`garminconnect`](https://github.com/cyberjunky/python-garminconnect),
  an **unofficial**, community library. Garmin may change or block it at any time, and automated
  access may not be allowed by Garmin's terms. **You** log in with your own account and are
  responsible for how you use it.
- The Strava integration uses only **Strava's own MCP connector** (for Strava subscribers, for
  personal use of their own data) and **files you export yourself**. You are responsible for
  following Strava's terms.
- You are responsible for complying with the terms of every service you connect, including your AI
  provider's.

## Your data

- Your training and health data stay **on your own computer**, in folders this project never
  commits (`athletes/`, `data/`). Nobody behind OpenSportCoach receives it.
- The coach is an AI model that runs on your AI provider's servers (for example Anthropic, through
  Claude Code). Whenever you use OpenSportCoach, the data the coach reads — including health
  information and what you type — is **sent to that provider** and handled under **your** agreement
  with them and your account's privacy settings, including how long it is kept and whether it may be
  used to train models. OpenSportCoach does not control this. Read their privacy terms, and share only
  what you are comfortable sending.
- Health data is sensitive. Protect your computer, and do not commit your `athletes/` or `data/`
  folders to any public repository.

## Changes

This disclaimer can change. When its version changes, the coach asks you to accept it again before it
plans anything.
