# Spectral Spells

My EE 102A final project. You fight a water mage by saying spells into your microphone. The game filters your recording, compares it with reference recordings of the spell, and uses the match to decide how strong the spell is.

**Play:** `https://willbaosu.github.io/spectral-spells/`

![Game screenshot](docs/screenshot.png)

## The game

Every spell has a power from 0% to 100%, set by how closely your voice matches the incantation. The power is based on the correlation ρ between your recording and the reference recordings:

| ρ | Power |
|:--|:--|
| below 0.5 | 0% (the spell fizzles) |
| 0.5 to 0.8 | rises in a straight line from 0% to 100% |
| 0.8 or higher | 100% |

Each spell's effect is scaled by its power.

| Spell | When | At 100% power |
|:--|:--|:--|
| Fireball | Your turn | 26 damage. Halved while Bubble Barrier is up. |
| Lightning Bolt | Your turn | 20 damage. Doubled against Bubble Barrier, and it breaks the barrier. |
| Focus | Your turn | Your next 3 attacks deal 60% more damage. |
| Shield | When Nerith attacks | Blocks all of the incoming damage. |

For example, a Fireball said at 50% power does 13 damage, and a Shield at 50% power blocks half of the attack.

**Voice training.** The first time you open the game, it asks you to say each spell once. Each recording is added as an extra reference for that spell, so the game compares your voice with your own voice as well as with four computer voices. The recordings are saved in your browser, so you only train once. The **Voice training** button lets you redo any spell.

On your turn, pick a spell, press **Hear it** to hear the incantation, then press **Record** and say it. You can also upload an audio file. Nerith the Tidecaller then casts Water Jet (11 damage), Tidal Wave (20 damage), Healing Rain (heals 18), or Bubble Barrier. When an attack is coming, you can say "Shield" to block it or take the hit.

## How the scoring works

All of the signal processing is in [`js/dsp.js`](js/dsp.js).

1. **Bandpass filter.** The game takes the fft of the recording, multiplies by H(s) = rect(s/2f_high) − rect(s/2f_low) with f_low = 80 Hz and f_high = 4 kHz, and takes the inverse fft. H depends only on |s|, so the +nΔf and −nΔf points are kept together and the result stays real. This removes hum below the voice and hiss above it.

   ![Part a](docs/figures/partA_spectrum.png)

   *Part a. The spectrum |X(f)| of a noisy recording of "Fireball," shown with fftshift. Outside ±4 kHz there is only noise, and the bandpass removes it on both the positive and negative sides. The thin gap at 0 is the ±80 Hz cut.*

2. **Resampling.** The browser records at 48 kHz. The game converts to 16 kHz with linear interpolation. The bandpass already removed everything above 4 kHz, so 1/Δt = 16 kHz ≥ 2 · 4 kHz and nothing aliases.
3. **Noise removal.** The signal is cut into short pieces and each piece is fft'd. The quietest 10% of pieces are taken as background noise, which gives a noise level at each frequency. Each piece is scaled down at frequencies where the noise is as strong as the voice, then inverse fft'd.

   ![Part b](docs/figures/partB_noise_removal.png)

   *Part b. The same recording clean, with random noise added (voice power = 10 × noise power), and after the bandpass and noise removal.*

4. **Finding the word.** The game keeps the loudest stretch of speech and drops silence, coughs, or a repeated word.
5. **Frequencies over time.** The game takes an fft of every 32 ms piece, every 10 ms (N = 512, so Δf = 1/(NΔt) = 31.25 Hz). Each fft is summed into 24 frequency bands. Then the log band energies of each piece get an inner product with cosines, like Fourier series coefficients. The low coefficients describe which sound is being made. Pitch and loudness are left out, so different voices saying the same word look alike.

   ![Part c](docs/figures/partC_short_ffts.png)

   *Part c. Short ffts of three recordings: time left to right, frequency bottom to top, brighter is stronger. The horizontal stripes in the reference are the harmonics f, 2f, 3f, ... of the voice. The new voice saying "Fireball" has the same overall shape as the reference. Saying "Focus" does not.*

6. **Correlation.** Your result C is compared with each reference R using normalized correlation, ρ = Σ R·C / √(ΣR² · ΣC²). The game slides your recording up to ±150 ms and stretches it between 80% and 125% to allow for timing. It keeps the highest ρ across all references of the spell: four computer voices plus your training recording.

## Test results

**How it was tested.** Each spell has four reference recordings, made with text-to-speech voices. The game compares your voice against these. To check that the game also works on voices it has never heard, 24 test recordings were made with six other text-to-speech voices. Each test voice says all four spells. Every test recording was then scored against every spell.

**Does saying the right spell score higher than saying the wrong one?** Each number is a peak ρ.

| Spell selected | Right word said (average) | Right word said (worst voice) | Wrong word said (average) |
|:--|:--|:--|:--|
| Fireball | 0.72 | 0.65 | 0.43 |
| Focus | 0.75 | 0.67 | 0.42 |
| Lightning Bolt | 0.70 | 0.53 | 0.46 |
| Shield | 0.91 | 0.81 | 0.54 |

For example, the Fireball row means: when the six test voices said "Fireball," their recordings averaged ρ = 0.72 against the Fireball references, and the lowest was 0.65. When they said one of the other three spells, the score against Fireball averaged 0.43, which fizzles.

For every spell, the right word scores well above 0.5 and the wrong words average below it, except for Shield. Shield is the most forgiving. A wrong word averages 0.54 there, which would still block about 13% of an attack.

The test also checked which spell each recording matched best. In 23 of the 24 recordings, that was the spell actually said. The one miss was a high-pitched voice saying "Focus," which scored 0.68 on Shield and 0.67 on Focus. This cannot cause a problem in a fight, since Focus can only be cast on your turn and Shield only when Nerith attacks.

![Part d](docs/figures/partD_scores.png)

*Part d. The numbers from the table above. Blue bars should be above the red line and orange bars below it.*

**Does it work with background noise?** Random noise was added to the test recordings. The table shows the average peak ρ for the right word.

| Voice power / noise power | 40 dB | 20 dB | 10 dB | 5 dB | 0 dB |
|:--|:--|:--|:--|:--|:--|
| With noise removal | 0.74 | 0.72 | 0.67 | 0.61 | 0.57 |
| Bandpass only | 0.74 | 0.68 | 0.61 | 0.56 | 0.49 |

At 0 dB the noise is as strong as the voice. With noise removal, the right word still stays above the fizzle line.

![Part e](docs/figures/partE_noise.png)

*Part e. The same results as a plot, with the wrong-word score added.*

**Limitation and voice training.** All of the test voices are text-to-speech. A real voice scored much lower against the computer-voice references (ρ = 0.27 to 0.47 in a first try), so every spell fizzled. That is why the game asks you to record each spell once. In a simulation where three test voices recorded their own training takes and then cast at a different speed and pitch, training raised the right-word score from 0.81 to 0.94 on average, while wrong words stayed at 0.45.

The figures were made with [`report_figures.m`](report_figures.m) in MATLAB. To rerun the tests: `node tests/run_tests.js`. It also checks that the FFT matches the DFT computed directly and that the bandpass keeps a 1 kHz tone while removing 30 Hz and 6 kHz tones.

## Running it

The page loads its recordings with `fetch`, so it has to be served from a web server. Opening `index.html` directly will not work.

**GitHub Pages:** Settings → Pages → Deploy from a branch → `main`, `/ (root)` → Save. Browsers only allow the microphone on HTTPS pages, which GitHub Pages provides.

**On your computer:** run `python3 -m http.server 8000` in this folder and open `http://localhost:8000`.

## Files

```
index.html               game page
css/style.css            layout and colors
js/dsp.js                signal processing
js/game.js               spells, combat, recording
js/sprites.js            pixel-art sprites
js/fx.js                 spell animations
js/charts.js             plots of your last cast
report_figures.m         MATLAB script for the README figures
spells/<spell>/*.wav     reference recordings, four voices per spell
enemy/*.wav              Nerith's spell lines
tests/run_tests.js       tests
tests/audio/*.wav        test recordings
docs/                    screenshot and figures
```

## Credits

The recordings were made with the Flite and eSpeak NG text-to-speech programs.
