# Support reports

After reproducing a problem, open the Frisquet Connect app's settings in Homey
and select **Prepare report**. This works even when an unfamiliar device could
not be paired.

Review the preview, then either:

- Download/copy the JSON and attach it to a GitHub support issue.
- Send an **app diagnostic report** for Frisquet Connect from Homey. The prepared
  bundle is already included in the app log. Share Homey's report identifier in
  the issue so the maintainer can locate it.

A general Homey system diagnostic report is different from an app report. The
maintainer needs the Frisquet app report. Include a short description of what
went wrong; the technical details are supplied by the report.

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

Homey's rolling app log also receives compressed, chunked raw records. Its own
retention may be shorter. Preparing a report writes a fresh complete bundle to
that log, so send the Homey app report directly afterwards. If log chunks are
missing, use the JSON download instead.

## Maintainer workflow

JSON downloads are readable directly. For exported Homey app logs:

```sh
npm run --silent decode:report -- /path/to/homey-app-log.txt > /path/to/frisquet-report.json
```

The decoder accepts text logs or JSON log exports, reassembles compressed chunks,
and reports incomplete records. It prefers the latest prepared bundle. If there
is none, it returns the complete raw trace entries still present in the log.

Compare the raw responses with the failing command and the app version. Use a
sanitized response as a local regression fixture before adapting a mapping.
Keep customer reports out of the public repository; reduce and inspect a fixture
before committing it. A report shows what the cloud returned, but cannot prove
physical burner state or undocumented device semantics on its own.
