# Frisquet Connect for Homey Pro

A native Homey SDK v3 app for Frisquet boilers equipped with a Frisquet Connect
box. It runs on Homey Pro and talks directly to Frisquet's cloud. No Home Assistant
instance, Raspberry Pi, container, MQTT broker, or computer left running is needed.

**Version 0.4.0** combines heating and hot water in one device, with Boost as the
quick action and equipment/installation details in the sensor view. Automated
checks and live verification are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

## Requirements

- Homey Pro Early 2023, updated to **Homey 12.9.0 or newer** (Node.js 22 runtime).
- A paired Frisquet Connect box and an account that already works in the official app.
- Internet access for Homey and the Frisquet box.
- A computer with **Node.js 24 or newer** for the current Homey CLI, used only for
  installation/development.

## Install on your Homey

Install the official Homey CLI once:

```sh
npm install --global homey@4.6.2
```

Then, from this project folder:

```sh
homey login
homey select
npm ci
homey app install
```

`homey login` opens Athom's sign-in page; `homey select` chooses your Homey Pro.
`homey app install` leaves the app running on Homey after the command exits.
You can turn off the computer afterwards. Do not use `--clean` on upgrades:
that deletes existing paired devices and their settings.

The Homey CLI supplies the SDK at runtime. The app has no runtime npm dependencies
and requests no Homey permissions. Its ID is `community.frisquet.connect`.
This is a release candidate; the App Store version requires Athom certification.

Official references: [Homey CLI installation and commands](https://apps.developer.homey.app/the-basics/getting-started/homey-cli),
[Homey's Node.js 22 runtime](https://apps.developer.homey.app/upgrade-guides/node-22).

## Pair devices

1. In Homey, choose **Devices → + → Frisquet Connect → Boiler & heating**.
2. Enter the email and password used in the official Frisquet Connect app.
3. Select your installation. Its heating zones, hot-water mode and information
   are included in one device. An outdoor probe is shown when reported.

Existing boiler devices acquire the new capabilities automatically when the app
is upgraded. The old heating-zone driver remains compatible with previously
paired devices and Flows, but is no longer offered for new pairing.

For a new device, open its **Settings → Status indicator → Room temperature**
to show the room reading on its tile. Boost is the separate quick action.
Existing indicator selections are retained on upgrade. The app does not change
Homey's device presentation settings or request permission to control other apps.

Your credentials are entered in Homey's pairing screen, not in source code or
terminal commands. Homey stores them in each device's private store to renew
expired sessions. Tokens stay in memory. Logs/errors never include raw API
responses, credential-bearing URLs, passwords, or tokens. The app has no analytics
or third-party backend. Its cloud connections go to `fcutappli.frisquet.com` and
`fcappcom.frisquet.com`.

When your Frisquet password changes, use **Repair** in a paired device's settings.
Repair updates other paired devices using that account when their installations
are also accessible to the new login. No re-pairing or Flow recreation is needed.

## Controls and their meaning

| Control | Effect |
| --- | --- |
| Zone target temperature | Changes the stored temperature for the active Comfort, Reduced, or Frost profile. This also affects future scheduled periods using that profile. |
| Schedule | Returns this zone to its Frisquet schedule, disables boost, and cancels any installation-wide temporary override. |
| Comfort always / Reduced always | Selects the permanent mode for this zone. |
| Frost protection | Selects this zone's frost-protection mode; it does not cut power to the boiler or turn off domestic hot water. |
| Boost quick action | Toggles the zone's Boost function when supported. Turning it off leaves the underlying mode and installation override intact. |
| Comfort / Reduced / Frost temperatures | Select a profile in the temperature control to see its numeric °C value and adjust it with +/−. Each edits its stored temperature without switching the active profile. |
| Active profile | Shows the current profile, including temporary override or holiday state. |
| Applied setpoint | Shows the boiler's reported `CAMB`, which can differ from the stored profile temperature. |
| Boiler mode | Selects a hot-water mode returned by your installation, such as Eco, MAX, a timer mode, or Stop. IDs are discovered rather than assumed. |
| Heater mode | Selects Schedule, Comfort always, Reduced always, Frost protection or Boost. |

Temperature writes are limited to **5–25 °C in 0.5 °C steps**. The app does not
infer burner activity from room temperature. The inspected Frisquet response
does not expose domestic-hot-water or heating-circuit water temperatures.

## Information view

The sensor view, alongside **Applied setpoint**, includes:

- Numeric Comfort, Reduced and Frost temperatures, so all three can be compared.
- Equipment model, product range, variant, rated power, serial and Connect ID.
- The boiler's reported clock, formatted in the installation's time zone. It is
  a reported reading updated on each poll, not a continuously ticking clock.
- Service-alarm descriptions and a separate alarm indicator, in addition to
  ordinary boiler alarms.
- Hot-water storage type, solar configuration and reported equipment presence.
- Installation name, postcode, country and time zone.
- Configured alert email addresses and phone numbers.

These details are read-only. Missing fields show **Not reported**; empty contact
lists show **None configured**. An empty service-alarm list shows **No service
alarms**, while an unavailable list is left unknown. Alert contacts and equipment
identifiers appear only in the device view; they are omitted from diagnostics
and logs. No emails or phone messages are sent by this app.

The API's temporary override command (`MODE_DERO`) has **no zone parameter**.
It is exposed as a boiler/installation Flow action, rather than a per-zone
temporary mode. Treat it as installation-wide and verify the affected zones on
your boiler. Returning a zone to Schedule may clear that override across the
installation. Permanent zone controls use explicitly numbered zone commands.

## Homey Flows

- **Set heating mode** on the combined device or a previously paired zone.
- **Set profile temperature** to edit Comfort, Reduced, or Frost without switching
  the active profile.
- **Set hot-water mode** on the boiler device; the picker lists its supported modes.
- **Set installation override** to request temporary Comfort/Reduced or cancel it.
- **Set Boost**, **Boost is enabled**, and **Boiler mode changed**.
- **Heating mode changed**, **Command status changed**, and **Heating mode is**.
- Homey's standard current/target-temperature cards and boiler alarm cards.

For example: when everyone leaves, set each desired heating zone to Reduced
always; when someone arrives, select Schedule. Use the profile-temperature action
when you want to configure a profile without activating it.

## Cloud updates and command acknowledgement

All devices on the same installation share one automatic poll every **five
minutes**. There is no manual Refresh button. Commands trigger follow-up reads.
Failures back off; authentication expiry triggers at most one renewal/retry per
request. Transport errors on writes are not automatically replayed, because the
server might have received the command before the response was lost.

**Last command** is shared across the installation:

- **Pending:** submitted or being submitted to Frisquet.
- **Confirmed:** Frisquet's WebSocket returned `ORDRE_OK`.
- **Unconfirmed:** no acknowledgement arrived within 20 seconds, or a transport
  failure left the result uncertain. Check the official app/device state before
  retrying; this does not necessarily mean the command failed.
- **Failed:** the command was rejected.

This status describes the latest command from this Homey app, not every change
made using the official app. Writable controls show accepted requests while
cloud readings catch up; room temperature, applied setpoint and active profile
always show reported telemetry. A short-lived desired-state copy also routes
successive mode/temperature commands to the right profile. The boiler's own
schedule remains stored on the boiler.

## Initial hardware check

After pairing, compare room temperatures, mode, and hot-water mode with Frisquet
Connect. Test one reversible change at a time and restore the original setting:
first a zone setpoint, then a mode, then hot water. Check Last command and allow
for Frisquet's update delay. Finally restart the Homey app and check that devices
reconnect without re-pairing. No live heating commands have been sent by the
automated tests in this repository.

If something fails, the useful details are the boiler model, Homey firmware,
which action failed, the sanitized error/status, and what the official app shows.
Do not paste your password or token. Holiday mode must be ended in the official
app before this app changes heating modes; holiday scheduling, weekly programme
editing, and consumption history are outside this first version.

## Development

```sh
npm test
npm run check
homey app validate
homey app build
```

For interactive debugging directly on Homey:

```sh
homey app run --remote
```

Unlike `app install`, stopping `app run` uninstalls the development instance.
Use `app install` for normal use. The shipped tests use synthetic/public API
fixtures and a mocked Homey SDK; they do not require credentials or network access.

Implementation details and API mappings are in [docs/protocol.md](docs/protocol.md).
Release preparation and submission are described in [docs/PUBLISHING.md](docs/PUBLISHING.md).
Data handling is explained in [PRIVACY.md](PRIVACY.md).
Report problems in the [issue tracker](https://github.com/shuguet/homey-frisquet/issues).
The source port is credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
with the upstream MIT notice preserved in [LICENSE](LICENSE).
