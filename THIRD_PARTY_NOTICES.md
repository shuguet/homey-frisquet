# Source and attribution

The Frisquet API protocol and heating/hot-water control semantics were ported
from [Frisquet Connect for Home Assistant by TheGui01 (Guillaume SOURD)](https://github.com/TheGui01/Frisquet-connect-for-home-assistant).

Reference: version 2.5.6, repository revision
`3405be4d56456cba42abd61486e721cd46f3697f`, inspected on 2026-10-30.

The relevant upstream files are `custom_components/frisquet_connect/const.py`,
`frisquetAPI.py`, `climate.py`, `water_heater.py`, and `sensor.py`.
Their MIT license and copyright notice are preserved in [LICENSE](LICENSE).

Additional protocol/type references and the public test fixture come from
[home-assistant-custom-components/frisquet-connect by Bruno TÊTE](https://github.com/home-assistant-custom-components/frisquet-connect),
inspected on 2026-10-30. The fixture is derived from `tests/resources/sites.json`
(blob `9f0f0ad74da502046958616ca6c1876f28339841`) with account/location identifiers
removed. Equipment types and boiler-clock semantics are cross-checked against
`const.py` and `domains/site/site_detail.py`. The upstream 2025 MIT copyright
notice is also preserved in LICENSE.

This is a JavaScript port with a native Homey SDK v3 UI and lifecycle. It does
not bundle or execute Home Assistant. It uses the same Frisquet cloud endpoints.
The original code's logging of credentials/tokens and inferred heating/off state
have not been carried over. Device modes, acknowledgement state, and reported
temperatures are represented separately. Holiday scheduling and gas consumption
aggregation have not been ported in this version.

The app icon uses the Frisquet brand mark from its
[official SVG logo](https://www.frisquet.com/img/logo-frisquet.svg), formatted as
a monochrome icon. The app image and boiler driver image use the product
photograph and cutaway from the
[Hydromotrix Condensation Visio product page](https://www.frisquet.com/fr/chaudiere-gaz-condensation-hydromotrix-25-32-kw_61.html):

- `1668082268_Chaudiere-gaz-frisquet-hydromotrix-condensation-25kw_zoom.jpg`
- `1666611375_HM_25kW_zoom.png`

These brand assets remain the property of Frisquet S.A. and are not covered by
this project's MIT license. They identify the supported equipment. The driver
and Boost SVG icons and legacy zone illustration are original project artwork.
This app is not an official Frisquet or Athom product.
