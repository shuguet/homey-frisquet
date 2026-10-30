# Publishing Frisquet Connect

The release candidate is **0.5.0**, with app ID `community.frisquet.connect`.
The ID and driver IDs remain unchanged so existing devices and Flows can upgrade.

Publisher: Sylvain Huguet. Source and support:
[shuguet/homey-frisquet](https://github.com/shuguet/homey-frisquet).

## Release checks

```sh
npm ci
npm test
npm run check
npm run check:release
homey app build
homey app validate --level publish
```

Use Node.js 22 for runtime compatibility tests and Node.js 24 or newer for Homey
CLI 4.6.2. The checks do not send heating commands or require Frisquet credentials.
`check:release` checks versions, translations, store text, release notes, image
dimensions, project links, permissions and the main device controls. CLI validation
checks Homey's schema and package rules; it does not replace Athom's review.

Install a candidate on a test Homey with `homey app install`. Do not use `--clean`
on an existing installation. Confirm pairing and Repair, both mode pickers,
profile temperature controls, Boost, automatic updates, Flows and reconnection
after restarting the app. Verify phone rendering in English and French. On
installations with several zones, verify each zone separately. Use the official
Frisquet app to compare state and restore any settings changed during testing.

## Upload and certification

1. Sign in using `homey login`, then run `homey app publish` in the project root.
   Keep version 0.5.0 for the first upload of this candidate. English and French
   release notes are already in `.homeychangelog.json`.
2. Open [Homey Developer Tools](https://tools.developer.homey.app), choose
   **Apps SDK → My Apps → Frisquet Connect**, and open the uploaded Draft.
3. Review the English/French listing, artwork, supported platform and links.
   Submit for certification with **publish directly after approval disabled**
   if the first release should be available only to testers.
4. Once certified, release to **Test** and share the test URL shown in the
   dashboard. A never-published app requires certification before becoming
   available to other users, including through its Test link.
5. After testing, release the approved build to **Live** in Developer Tools.
   Subsequent updates use a higher semantic version and new release notes.

Publishing for Homey Pro does not require a paid Verified Developer subscription.
This app targets `local` (Homey Pro), although it uses Frisquet's cloud service.
It is not a Homey Cloud or Homey Bridge integration.

## Notes for the reviewer

Community integration for Frisquet boilers equipped with Frisquet Connect.
The app runs directly on Homey Pro using HTTPS and WSS to Frisquet. No companion
server is required. The protocol is ported from MIT-licensed Home Assistant
integrations, credited in the manifest, LICENSE and THIRD_PARTY_NOTICES.md.

One paired device includes heating zones, hot water, equipment information and
alarms. Temperature controls edit stored profile temperatures; schedules and
holidays remain managed in the official app. Polling is shared per installation
at five-minute intervals, with command follow-up reads and failure backoff.

No Homey permissions or runtime npm dependencies are requested. Room temperature
can be selected in the device's status-indicator settings. Boost is the quick
action. Legacy paired zone devices remain compatible, but that driver is not
offered for new pairing. The app does not infer water temperatures or burner
activity from room temperature.

Account credentials stay in Homey's private device stores and session tokens
remain in memory. Support history captures anonymized raw equipment responses,
commands and errors with bounded local retention. Users can preview and share a
report from app settings; authentication bodies are never logged. There is no
analytics or developer-operated backend. See PRIVACY.md for details. Manufacturer artwork
sources and ownership are recorded in THIRD_PARTY_NOTICES.md; the listing clearly
identifies the integration as unofficial.

## Official references

- [Publishing and certification](https://apps.developer.homey.app/app-store/publishing)
- [Store guidelines](https://apps.developer.homey.app/app-store/guidelines)
- [Permission restrictions](https://apps.developer.homey.app/the-basics/app/permissions)
- [Homey Pro and Homey Cloud publishing](https://apps.developer.homey.app/guides/homey-cloud)
