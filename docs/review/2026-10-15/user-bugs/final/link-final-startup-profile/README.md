# Short Link Final phase profile

Candidate `game-rdv3pg8d.js`, source `b242558d…`. A controlled resource and
placement fixture activates the real Final with the saved DOM special key.
Ninety fixed ticks and ninety explicit GPU draws cover owner ages 1–90.
The pair is Link/Pikachu; its loading budget includes the Link owner page,
so these results do not measure a cold unprepared owner page in every
four-player roster.

The first 30-tick batch spends 32.2 ms in simulation (maximum 4.2 ms per
tick), 14.4 ms across 60 view reads (maximum 1.1 ms), 9.4 ms in the remaining
host updates, and 174.8 ms across 30 drawing calls (maximum 12.7 ms).
Subsequent maximum draw calls are 6.8 and 20.8 ms. Observed WebGL texture
upload calls are at most 0.1 ms; shader/link query calls at most 0.7 ms.
Zero unhandled errors. No simulation/history serialization spike is found
in this targeted case.

Forced draws can fill an asynchronous software GPU queue. These timings
are not normal RAF frame-rate acceptance and do not explain or dismiss
the earlier 15.7-second accelerated 300-tick batch. No gameplay or shader
change was made based on this diagnostic.
