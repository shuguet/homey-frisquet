# Privacy

Frisquet Connect for Homey Pro runs on your Homey and communicates directly with
Frisquet. It has no analytics, advertising or developer-operated server.

## Account and device data

The email address and password entered during pairing are saved in each device's
private Homey store so the app can renew expired Frisquet sessions. Session tokens
are kept in memory. Credentials are sent only to Frisquet over HTTPS.

The app reads heating temperatures and modes, hot-water modes, alarms, equipment
identifiers and installation information. If Frisquet supplies alert email
addresses or phone numbers, the app displays them in the device information view.
It does not send messages to those contacts or change their configuration.

Network connections used for the integration:

- `fcutappli.frisquet.com`: authentication, installation readings and commands.
- `fcappcom.frisquet.com`: encrypted WebSocket command acknowledgements.

The app requests no Homey permissions and does not access other apps' devices.
Homey controls access to device information, Flow tags, Insights and backups.
Anyone with sufficient access to your Homey may be able to view this information.

Optional connection and alarm notifications use Homey's notification service.
When enabled, they include the paired device name and, for alarms, the alarm text
reported by Frisquet. Both notification options are off by default. Local app
settings retain outage timestamps and hashes of observed alarm names to avoid
repeated notifications across restarts; this state contains no credentials or
plain-text equipment identifiers. Notification delivery and history are managed
by Homey and your notification preferences.

## Diagnostics and retention

App logs contain anonymized raw Frisquet equipment responses, commands, response
status, timing, errors, software versions and paired driver/capability IDs.
Authentication request and response bodies are never
recorded. Known credential, contact, location, free-text name and equipment-ID
fields are anonymized before storage or logging. Known secret values and common
email, phone, IP and token formats are also filtered when repeated in other fields.
Equipment identifiers use stable aliases to match related exchanges.

Unknown technical fields are preserved for diagnosing different hardware.
Operating information such as temperatures, modes, schedules and configuration
can remain in a report. The advanced section in the app's Configure page lets you
inspect saved history. No report is automatically uploaded to a developer-operated
service.

The app retains at most 128 records, 256 KiB and 24 hours of local history,
whichever limit is reached first. Raw payload capture is also size-limited and
marks truncation. History is saved in Homey's app settings across restarts,
usually within ten seconds. Clear it using **Clear local history**. Homey's own
app logs and backups have separate retention controls.

**Create Diagnostics Report**, on Homey's app management page, sends recent app
logs to the developer through Homey's reporting service when the user submits
the form. It does not require a JSON export or a preparation step.
**Advanced → Preview saved history** packages the longer local history and adds
it to the app log. It does not upload the history. Users can download/copy that
JSON and choose where to share it. The app's support API endpoints require Homey
authentication. Device names, stores and account settings are not dumped into
the report.

Removing every device associated with an account removes its credential stores
from the app's active device data. Account sessions are closed when no paired
device uses them. Homey backups and historical data follow Homey's own retention
and deletion controls. Removing a Homey device does not delete a Frisquet account
or change the boiler's configuration.

## Support

Send a Homey app diagnostic report after reproducing a problem. The
[project issue tracker](https://github.com/shuguet/homey-frisquet/issues) is also
available for discussion. Issues are public: describe the problem and provide
the Homey report ID, or attach an advanced export after reviewing it.
The report supplies software versions and available equipment details. Omit
passwords, tokens, serial numbers, addresses and alert contacts from screenshots
and any text you add yourself.

Frisquet and Homey provide their own services under their respective privacy
policies. This community integration is not an official Frisquet or Athom product.
