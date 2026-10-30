# Validation — 0.4.0

Checked on 2026-10-30 with Node.js 22.23.4 and Homey CLI 4.6.2.
The target runtime is Homey’s Node.js 22 (firmware 12.9.0 or newer).

- 44 automated cases passed: 13 API/transport, 12 model/mapping, 3 information
  formatting, 6 connection lifecycle/queue, 9 Homey SDK boundary cases and
  1 error-localization case.
- JavaScript syntax, JSON and release metadata checks passed.
- Homey build and publish-level validation passed without permission warnings.
- No Homey permissions or runtime npm dependencies are requested.

The fixtures are synthetic or sanitized public upstream examples. Tests cover
request formatting, concurrent authentication renewal, bounded retries,
timeouts, no replay of ambiguous writes, command acknowledgements, temperature
scaling and profile routing, zone and installation scope, time zones, dynamic
hot-water modes, offline recovery, shared polling, serial commands, pairing,
Flows, credential repair and resource cleanup.

Additional coverage includes read-only installation information, contact
formatting, nullable equipment flags, alarm clearing, boiler clock time zones
and daylight saving, removal of Refresh on upgrade, periodic information updates,
and French pairing/control/offline errors without exposing transport details.

The App Store release removes automatic indicator selection and the broad Homey
API permission previously used for it. Room temperature remains selectable in
device settings, and an existing selection is not changed by the app.

## Hardware verification

Earlier versions were tested on Homey Pro Early 2023 with a Frisquet Connect
installation. Live checks confirmed Frisquet’s ORDRE_OK acknowledgement when
resubmitting existing Comfort temperature, Boost-off and hot-water settings.
The combined device, information fields, native numeric profile editors,
Boost quick action and Room temperature indicator were verified through Homey’s
device metadata.

Version 0.4.0 was installed as an upgrade without removing paired devices.
Live read-only verification confirmed the device was available, its existing
Room temperature indicator and Boost quick action were retained, all three
native profile editors matched their numeric readouts, and no slider component
was present. The diagnostic endpoint returned a connected installation.
No live heating commands are sent by the automated checks.

## Remaining release testing

Physical phone rendering in English and French has not been screenshot-tested.
Multi-zone and solar hot-water variants are covered by fixtures but still need
broader hardware testing. Publish-level validation is a schema/build check;
Athom certification is required before the first public Test or Live release.
