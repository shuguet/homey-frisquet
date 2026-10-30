# Privacy

Frisquet Connect for Homey Pro runs on your Homey and communicates directly with
Frisquet. It has no analytics, advertising, developer-operated server or external
crash-reporting service.

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

## Diagnostics and retention

App logs and error messages omit passwords, tokens and raw Frisquet responses.
The authenticated diagnostic endpoint contains thermostat readings, command
status and response field names. It omits account credentials, installation
identifiers, location values and alert contacts.

Removing every device associated with an account removes its credential stores
from the app's active device data. Account sessions are closed when no paired
device uses them. Homey backups and historical data follow Homey's own retention
and deletion controls. Removing a Homey device does not delete a Frisquet account
or change the boiler's configuration.

## Support

Use the [project issue tracker](https://github.com/shuguet/homey-frisquet/issues)
for app support. Issues are public: include the app and Homey versions, boiler
model, steps to reproduce and the displayed error. Omit passwords, tokens,
serial numbers, addresses and alert contacts from reports and screenshots.

Frisquet and Homey provide their own services under their respective privacy
policies. This community integration is not an official Frisquet or Athom product.
