# Support reports

After reproducing a problem, send **Homey's app diagnostic report** for Frisquet
Connect. Recent anonymized API exchanges and software/device context are already
in the app log. No export or preparation step is required.

- **Mobile:** More → Apps → Frisquet Connect → settings gear → Create Diagnostics Report.
- **Web:** Settings → Frisquet Connect → Create Diagnostics Report.

The button is on Homey's app management page, outside the app's Configure page.
Describe what went wrong in the report form and send it. Homey delivers the app
logs to the developer. If you also open a GitHub issue, include the report ID to
link the discussion to the delivered report; no JSON attachment is needed.

A general Homey system diagnostic report is different from an app report. The
maintainer needs the Frisquet app report.

## Advanced preview and export

Homey's report button is available for App Store installations. Development
installations made with the CLI do not show it. If the button is missing, support
needs older history, or you want to inspect saved data, open the app's Configure
page and expand **Advanced: preview or export history**. Select **Preview saved
history**, review the JSON, then download/copy it if needed. This works even when
an unfamiliar device could not be paired.

Opening the page or preview does not send a report. The preview also writes the
saved history into Homey's app log, so a native report sent immediately afterwards
can include it, subject to Homey's log limits.

## What is captured

- App, Homey firmware, platform generation, Node.js and architecture versions.
- Paired driver and capability IDs and device availability, without device names
  or private stores.
- Raw JSON from installation and command responses, captured before normalization
  or schema checks. Unknown fields and values remain available for offline work.
- Commands, HTTP status, request duration, retries and WebSocket JSON exchanges.
- Pairing/parsing failures, sanitized exception locations, app starts/stops and
  Homey's CPU/memory warning events.

Capture uses existing requests and makes no additional calls to Frisquet. The
device only captures, anonymizes, bounds and packages data. Hardware discovery,
protocol interpretation and fixture creation are maintainer tasks performed
after receiving the report.

Authentication bodies are omitted entirely. Sensitive field names, known secret
values and common identifying formats are filtered locally. Review PRIVACY.md
for the data handling details. Unknown technical fields may contain configuration
and operating information; inspect the preview before posting it publicly.

## Bounds and persistence

The journal keeps at most 128 records, 256 KiB and 24 hours. Large responses are
limited to approximately 64 KiB, 12 levels of nesting and 1,024 items per array;
truncation is marked. Older entries are removed first. History is saved locally
within ten seconds and on orderly shutdown/error reporting. A sudden power loss
can lose the most recent unsaved entries.

Homey's rolling app log receives compressed, chunked raw records as requests
happen, with software versions and paired device/capability context. Its retention
may be shorter than the local journal. Send the native report immediately after
reproducing the issue. If log chunks are missing or older history is needed, use
the advanced JSON download.

## Maintainer workflow

JSON downloads are readable directly. For exported Homey app logs:

```sh
npm run --silent decode:report -- /path/to/homey-app-log.txt > /path/to/frisquet-report.json
```

The decoder accepts text logs or JSON log exports, reassembles compressed chunks,
and reports incomplete records. It reads ordinary trace records without requiring
a prepared bundle. If a saved-history preview is also present, it merges that
bundle with the traces, including events after the preview, and removes duplicates.
It also accepts the JSON returned by Homey's per-build diagnostic-report API,
including log text in the `stack` field. Native delivery and decoding were
[verified with store Test version 0.5.1](VALIDATION.md#native-report-delivery).

Compare the raw responses with the failing command and the app version. Use a
sanitized response as a local regression fixture before adapting a mapping.
Keep customer reports out of the public repository; reduce and inspect a fixture
before committing it. A report shows what the cloud returned, but cannot prove
physical burner state or undocumented device semantics on its own.
