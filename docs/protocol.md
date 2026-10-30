# Protocol and implementation notes

Reference: [TheGui01/Frisquet-connect-for-home-assistant, v2.5.6](https://github.com/TheGui01/Frisquet-connect-for-home-assistant).
The API is unofficial. These mappings come from that source, not a published
Frisquet API specification. Live reads and no-op command acknowledgements have
been verified on a Homey Pro Early 2023 installation; see VALIDATION.md.

| Operation | Request |
| --- | --- |
| Sign in | `POST https://fcutappli.frisquet.com/api/v1/authentifications?app_id=…` |
| Read installation | `GET https://fcutappli.frisquet.com/api/v1/sites/{identifiant_chaudiere}?token=…` |
| Send orders | `POST https://fcutappli.frisquet.com/api/v1/ordres/{identifiant_chaudiere}?token=…` |
| Acknowledgement | `wss://fcappcom.frisquet.com/?token=…&identifiant_chaudiere=…` |

Login body: `locale: fr`, `email`, `password`, `type_client: IOS`. The upstream
Android-version and okhttp User-Agent headers are retained. Authentication returns
`token` and `utilisateur.sites`; sites are identified by boiler ID, never by the
position of a site in that array. The client uses a random app ID preserved in
the device store and percent-encodes query parameters.

Orders are a JSON array of `{ cle: KEY, valeur: INTEGER_AS_STRING }` objects.
Only these command families are accepted by the client:

| Key | Values / scope |
| --- | --- |
| `SELECTEUR_Zn` | 5 schedule, 6 permanent Comfort, 7 permanent Reduced, 8 Frost; zone n |
| `CONS_CONF_Zn` | Comfort profile temperature × 10 |
| `CONS_RED_Zn` | Reduced profile temperature × 10 |
| `CONS_HG_Zn` | Frost profile temperature × 10 |
| `ACTIVITE_BOOST_Zn` | 1 enable, 0 disable; zone n |
| `MODE_DERO` | 0 cancel, 6 temporary Comfort, 7 temporary Reduced; no zone selector |
| `MODE_ECS`, `MODE_ECS_PAC`, `MODE_ECS_SOLAIRE` | Mode IDs discovered in `modes_ecs`; active equipment variant |

`zones[].carac_zone` supplies `TAMB`, `CAMB`, `CONS_CONF`, `CONS_RED`, `CONS_HG`,
`SELECTEUR`, `MODE`, `DERO`, and `ACTIVITE_BOOST`. Temperatures are converted from
tenths of degrees. Missing values stay null. `MODE` is used for the current
scheduled/temporary profile; the half-hour schedule in the installation's own
timezone is a fallback. Sunday is `jour: 0`. Holiday state takes precedence.

Unlike the upstream Home Assistant climate entity, this app does not use
temperature differences to synthesize a heating/off mode. Its native mode is the
selector/boost state, and the active profile is reported separately.

After each accepted order, the client opens the acknowledgement WebSocket and
sends `{"type":"ORDRE_EN_ATTENTE"}`. Only `ORDRE_OK` produces Confirmed. A
20-second timeout or closed/error socket produces Unconfirmed, followed by a
read. HTTP 2xx alone is not presented as a boiler acknowledgement. This WebSocket
behaviour is ported from upstream and has been verified with commands that
repeat the installation's existing settings.

`app.js` pools clients per account and connections per installation. All zones
and the boiler share a connection, one poll timer, and one serial command queue.
Devices retain credentials privately, with tokens only in memory. Failed requests
expose fixed errors, never server bodies or URLs. 401/403 gets one coordinated
re-login; ambiguous writes are not automatically retried. Removing the last
device closes its connection and account client. Repair updates eligible devices
for the same account.

The read-only sensor view preserves an explicit subset of `produit`, `agi`,
`sigmacom`, location fields, `emails_alerte`, `telephones_alerte`, and `alarmes_pro`.
These user-requested details are excluded from diagnostic responses and logging.
`TYPE_ECS` 0 is without a storage tank; 1 is with a storage tank, following the
independent integration's enum. Unknown types are not guessed. `solaire` and
`AVEC_ECS` preserve unknown/null values. Service alarms are separate from normal
alarms; a missing list is unknown, and an empty list means no service alarms.
Boiler epoch seconds are formatted using the installation timezone, with an
explicit UTC fallback if it is absent or invalid.

Homey's custom `frisquet_boost` boolean declares `uiQuickAction: true`.
`button.refresh` is removed from existing devices at startup and omitted from
new pairings. Refreshing is owned by the shared five-minute poll timer and
command follow-up reads.

Profile editors use Homey's native `target_temperature.comfort`, `.reduced`
and `.frost` capabilities. The original `frisquet_*_temperature` numeric
capabilities remain as sensor readouts and compatibility aliases. Both routes
write the corresponding stored profile, independently of the active mode.

Device tile indicators are selected by the user in Homey's device settings.
The app does not request `homey:manager:api` or use the Homey Web API. Existing
indicator settings survive upgrades; room temperature remains available as
`measure_temperature`. Boost is the separate quick action.

No gas/energy capability is exposed: the upstream consumption endpoint aggregates
historical buckets, which must not be blindly treated as an ever-increasing
Homey meter. A future energy feature should first establish bucket/reset semantics
against real installations.
