# ClimateViewer icon legend

ClimateViewer vector markers draw at a fixed 32 × 32 px (`MARKER_PIXELS`).
Each layer's `markerScale` is clamped to 0.25–4, so a large source PNG never
grows past a readable badge or shrinks to an invisible dot.

The current catalog references **44 distinct marker images** across
66 vector layers. Assets live in the sibling `cv/` checkout and
are served from `/cv/img/...` after `npm run sync:cv`.

| Icon | Layers | Example layers |
| --- | ---: | --- |
| ![cv3d-red.png](../public/cv/img/cv3d-red.png) `cv3d-red.png` | 1 | CV Reports - 2011 - 2015 |
| ![eye-green.gif](../public/cv/img/gallery/eye-green.gif) `eye-green.gif` | 1 | Government Spy Facilities |
| ![airports.png](../public/cv/img/icons/airports.png) `airports.png` | 1 | UAV Drones over the USA |
| ![antenna.png](../public/cv/img/icons/antenna.png) `antenna.png` | 1 | ELF and VLF Visual Reference |
| ![digisonde.png](../public/cv/img/icons/digisonde.png) `digisonde.png` | 1 | DIGISONDE® Ionosonde Network |
| ![dollar.png](../public/cv/img/icons/dollar.png) `dollar.png` | 1 | Democracy of Chaos - Places affected by the 2013 U.S. Government Shutdown |
| ![doppler-blue.png](../public/cv/img/icons/doppler-blue.png) `doppler-blue.png` | 1 | Integrated Ocean Observing System (IOOS) Radar |
| ![doppler-green.png](../public/cv/img/icons/doppler-green.png) `doppler-green.png` | 2 | NEXRAD Doppler Radar Stations<br>Canadian Sigmet Doppler Radar Stations |
| ![doppler-red.png](../public/cv/img/icons/doppler-red.png) `doppler-red.png` | 1 | Joint Surveillance System (JSS), FAA Long-range Radar |
| ![doppler-yellow.png](../public/cv/img/icons/doppler-yellow.png) `doppler-yellow.png` | 1 | Terminal Doppler Weather Radar (TDWR) Stations |
| ![earthquakes.png](../public/cv/img/icons/earthquakes.png) `earthquakes.png` | 10 | USGS - All Earthquakes (Last Hour)<br>USGS - M4.5+ Earthquakes (Today) |
| ![eol.gif](../public/cv/img/icons/eol.gif) `eol.gif` | 1 | UCAR Earth Observing Lab Field Projects (Worldwide) |
| ![firedept.png](../public/cv/img/icons/firedept.png) `firedept.png` | 1 | Drilling Wells and Methane Release |
| ![ids.png](../public/cv/img/icons/ids.png) `ids.png` | 1 | DORIS (Doppler Orbitography and Radiopositioning Integrated by Satellite) |
| ![laser.png](../public/cv/img/icons/laser.png) `laser.png` | 1 | Lasers and Directed-Energy |
| ![lightning_bolt.png](../public/cv/img/icons/lightning_bolt.png) `lightning_bolt.png` | 2 | NOAA/NWS Hourly Storm Log<br>NOAA/NWS Daily Storm Log |
| ![mryuk.png](../public/cv/img/icons/mryuk.png) `mryuk.png` | 1 | Coal Ash in Ponds |
| ![nasa.png](../public/cv/img/icons/nasa.png) `nasa.png` | 1 | AERONET (AErosol RObotic NETwork) |
| ![noaa.gif](../public/cv/img/icons/noaa.gif) `noaa.gif` | 1 | Earth Systems Research Lab (ESRL) Instruments |
| ![nuke-blue.png](../public/cv/img/icons/nuke-blue.png) `nuke-blue.png` | 1 | Gas Cooled Reactors |
| ![nuke-boom.png](../public/cv/img/icons/nuke-boom.png) `nuke-boom.png` | 1 | Nuclear Test Explosions |
| ![nuke-dkblue.png](../public/cv/img/icons/nuke-dkblue.png) `nuke-dkblue.png` | 1 | Pressurized Heavy Water Reactors |
| ![nuke-green.png](../public/cv/img/icons/nuke-green.png) `nuke-green.png` | 1 | Pressurized Water Reactors |
| ![nuke-purple.png](../public/cv/img/icons/nuke-purple.png) `nuke-purple.png` | 1 | Other Reactors |
| ![nuke-red.png](../public/cv/img/icons/nuke-red.png) `nuke-red.png` | 1 | Boiling Water Reactors |
| ![nuke-yellow.png](../public/cv/img/icons/nuke-yellow.png) `nuke-yellow.png` | 1 | Light Water Graphite Reactors |
| ![nuke.png](../public/cv/img/icons/nuke.png) `nuke.png` | 2 | 50 Nuclear Nightmares (Hibakusha Worldwide)<br>1979 Three Mile Island Meltdown |
| ![oil_well.png](../public/cv/img/icons/oil_well.png) `oil_well.png` | 2 | Fracking America<br>Fracking Alaska |
| ![oil-well.png](../public/cv/img/icons/oil-well.png) `oil-well.png` | 1 | Black Tides: Worst Oil Spills in History |
| ![partly_cloudy.png](../public/cv/img/icons/partly_cloudy.png) `partly_cloudy.png` | 1 | Baseline Surface Radiation Network (BSRN) |
| ![poison.png](../public/cv/img/icons/poison.png) `poison.png` | 1 | NRDC Drinking Water Impacts 2011 |
| ![radar-black.png](../public/cv/img/icons/radar-black.png) `radar-black.png` | 1 | Missile Defense Radars (Star Wars) |
| ![radar-dish.png](../public/cv/img/icons/radar-dish.png) `radar-dish.png` | 2 | Other Radars, Observatories, Telescope Arrays, Satellite Communications<br>Other Radars, Observatories, Telescope Arrays, Satellite Comm (OVERLAY) |
| ![radar-ltblue.png](../public/cv/img/icons/radar-ltblue.png) `radar-ltblue.png` | 1 | High-Frequency Active Auroral Research Project |
| ![radar-pink.png](../public/cv/img/icons/radar-pink.png) `radar-pink.png` | 1 | NOAA Profiler Network (NPN) Wind Radar |
| ![radar-purple.png](../public/cv/img/icons/radar-purple.png) `radar-purple.png` | 1 | MADIS CAP Wind Radar |
| ![radar-red.png](../public/cv/img/icons/radar-red.png) `radar-red.png` | 1 | Ionospheric Heaters |
| ![radar-yellow.png](../public/cv/img/icons/radar-yellow.png) `radar-yellow.png` | 1 | Super Dual Auroral Radar Network (SuperDARN) |
| ![radioz.png](../public/cv/img/icons/radioz.png) `radioz.png` | 8 | Cell Phone Towers (USA FCC)<br>Paging Towers (USA FCC) |
| ![rainy.png](../public/cv/img/icons/rainy.png) `rainy.png` | 1 | Weather Modification Inc. Projects (Worldwide) |
| ![rf-warning.png](../public/cv/img/icons/rf-warning.png) `rf-warning.png` | 1 | ELF and VLF Transmitters |
| ![smoke-grey.png](../public/cv/img/icons/smoke-grey.png) `smoke-grey.png` | 1 | Coal Power Plants (future) |
| ![smoke-red.png](../public/cv/img/icons/smoke-red.png) `smoke-red.png` | 1 | Coal Power Plants (current) |
| ![volcano.png](../public/cv/img/icons/volcano.png) `volcano.png` | 2 | Weekly Activity and Eruptions<br>Global Vocanoes |
