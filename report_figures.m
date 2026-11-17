% Spectral Spells report figures
% Run from the spectral-spells folder.

% Load a test recording, pad with 0.5 s of silence on each side
[x, fs] = audioread('tests/audio/fireball__rms.wav');
x = x(:, 1);
pad = zeros(round(fs/2), 1);
x = [pad; x; pad];
N = length(x);
dt = 1/fs;
t = (0:N-1)' * dt;

% Add random noise: voice power = 10 x noise power (10 dB)
rng(7);
xn = x + randn(N, 1) * sqrt(mean(x.^2) / 10);

% Bandpass with the FFT: keep 80 Hz <= |f| <= 7 kHz
X = fft(xn);
f = (0:N-1)' * fs / N;
f(f >= fs/2) = f(f >= fs/2) - fs;
H = abs(f) >= 80 & abs(f) <= 7000;
xb = real(ifft(X .* H));

% Part a: two-sided spectrum before and after the bandpass
fsh = ((0:N-1)' - floor(N/2)) * fs / N;
figure('Position', [100 100 600 400]);
semilogy(fsh/1000, fftshift(abs(X)), 'LineWidth', 1.5);
hold on;
semilogy(fsh/1000, fftshift(abs(fft(xb))) + 1e-3, ...
    'LineWidth', 1.5);
xlim([-8 8]);
xlabel('Frequency (kHz)');
ylabel('|X(f)|');
title('Part a: Spectrum before and after the bandpass');
legend('Before bandpass', 'After bandpass');
grid on;

% Noise removal: fft short pieces, scale down noisy points
L = 512;
hop = L/2;
w = 0.5 - 0.5*cos(2*pi*(0:L-1)'/L);
nP = floor((N - L)/hop) + 1;
S = zeros(L, nP);
for k = 1:nP
    idx = (k-1)*hop + (1:L);
    S(:, k) = fft(xb(idx) .* w);
end
P = abs(S).^2;
% Noise level: average of the quietest 10% of pieces
[~, order] = sort(sum(P, 1));
nq = max(3, floor(0.1*nP));
noiseP = mean(P(:, order(1:nq)), 2);
G = max(1 - 2*noiseP ./ (P + 1e-12), 0.05);
xd = zeros(N, 1);
for k = 1:nP
    idx = (k-1)*hop + (1:L);
    xd(idx) = xd(idx) + real(ifft(S(:, k) .* G(:, k)));
end

% Part b: the signal over time
figure('Position', [100 100 600 400]);
subplot(3, 1, 1);
plot(t, x, 'LineWidth', 1.5);
title('Part b: Clean recording');
ylabel('x(t)'); ylim([-0.5 0.5]); grid on;
subplot(3, 1, 2);
plot(t, xn, 'LineWidth', 1.5);
title('With random noise added');
ylabel('x(t)'); ylim([-0.5 0.5]); grid on;
subplot(3, 1, 3);
plot(t, xd, 'LineWidth', 1.5);
title('After bandpass and noise removal');
ylabel('x(t)'); ylim([-0.5 0.5]); grid on;
xlabel('Time (s)');
% Same time range on all three plots
for i = 1:3
    subplot(3, 1, i);
    xlim([0 t(end)]);
end

% Part c: short ffts (32 ms pieces every 10 ms)
files = {'spells/fireball/slt.wav', ...
    'tests/audio/fireball__esm1low.wav', ...
    'tests/audio/focus__esm1low.wav'};
names = {'Part c: Reference, Fireball', ...
    'New voice, Fireball', 'New voice, Focus'};
figure('Position', [100 100 900 400]);
for i = 1:3
    [y, fy] = audioread(files{i});
    y = y(:, 1);
    L = round(0.032*fy);
    hop = round(0.010*fy);
    w = 0.5 - 0.5*cos(2*pi*(0:L-1)'/(L-1));
    nP = floor((length(y) - L)/hop) + 1;
    S = zeros(L, nP);
    for k = 1:nP
        S(:, k) = fft(y((k-1)*hop + (1:L)) .* w);
    end
    fk = (0:L-1) * fy / L;
    keep = fk <= 7000;
    D = 20*log10(abs(S(keep, :)) + 1e-6);
    tk = ((0:nP-1)*hop + L/2) / fy;
    subplot(1, 3, i);
    imagesc(tk, fk(keep)/1000, D);
    axis xy;
    caxis([max(D(:)) - 60, max(D(:))]);
    xlabel('Time (s)');
    if i == 1
        ylabel('Frequency (kHz)');
    end
    title(names{i});
end
colormap(hot);

% Run the tests with Node.js, which saves tests/results.json
nodeCmd = 'node';
[st, ~] = system('node --version');
if st ~= 0
    % Look for node where it is usually installed
    places = {'/usr/local/bin/node', '/opt/homebrew/bin/node'};
    nodeCmd = '';
    for i = 1:numel(places)
        if exist(places{i}, 'file')
            nodeCmd = places{i};
        end
    end
end
if isempty(nodeCmd)
    error('Node.js not found. Install it from nodejs.org.');
end
disp('Running the tests (about 15 s)...');
[st, out] = system([nodeCmd ' tests/run_tests.js']);
disp(out);
if st ~= 0
    warning('Some tests failed. See the output above.');
end
r = jsondecode(fileread('tests/results.json'));
spells = r.names;
hasReal = ~isempty(r.real);

% Part d: right word vs wrong word for each spell
ttsRight = [r.tts.per.right_mean]';
ttsWrong = [r.tts.per.wrong_mean]';
if hasReal
    realRight = [r.real.per.right_mean]';
    realWrong = [r.real.per.wrong_mean]';
    D = [ttsRight ttsWrong realRight realWrong];
    names = {'Text-to-speech, said this spell', ...
        'Text-to-speech, said another spell', ...
        'Real voices, said this spell', ...
        'Real voices, said another spell'};
else
    D = [ttsRight ttsWrong];
    names = {'Said this spell', 'Said another spell'};
end
figure('Position', [100 100 600 400]);
bar(D);
hold on;
plot([0.5 4.5], [0.5 0.5], 'r--', 'LineWidth', 1.5);
plot([0.5 4.5], [0.8 0.8], 'g--', 'LineWidth', 1.5);
set(gca, 'XTick', 1:4, 'XTickLabel', spells);
ylim([0 1.7]);
ylabel('Average peak \rho');
legend([names, {'Fizzle below', 'Full power above'}], ...
    'Location', 'northwest');
title('Part d: Right word vs wrong word');
grid on;

% Part e: score vs background noise
figure('Position', [100 100 600 400]);
plot(r.noise.snr, r.noise.denoise, 'o-', 'LineWidth', 1.5);
hold on;
plot(r.noise.snr, r.noise.bandpass, 's-', 'LineWidth', 1.5);
plot(r.noise.snr, r.noise.wrong, '^-', 'LineWidth', 1.5);
plot([0 40], [0.5 0.5], 'r--', 'LineWidth', 1.5);
set(gca, 'XDir', 'reverse');
xlabel('Voice power / noise power (dB)');
ylabel('Average peak \rho');
ylim([0.25 0.85]);
legend('Right word, noise removal', ...
    'Right word, bandpass only', 'Wrong word', ...
    'Fizzle below', 'Location', 'southwest');
title('Part e: Score vs background noise');
grid on;

% Part f: frequency scaling on and off
S = r.scaling;
groups = {'Text-to-speech'};
F = [S.tts.off.right S.tts.on.right ...
    S.tts.off.wrong S.tts.on.wrong];
if hasReal
    groups = [groups, {'Real voices'}];
    F = [F; S.real.off.right S.real.on.right ...
        S.real.off.wrong S.real.on.wrong];
end
figure('Position', [100 100 600 400]);
bar(F);
hold on;
plot([0.5 numel(groups)+0.5], [0.5 0.5], 'r--', ...
    'LineWidth', 1.5);
set(gca, 'XTick', 1:numel(groups), 'XTickLabel', groups);
ylim([0 1.5]);
ylabel('Average peak \rho');
legend('Right word, no scaling', 'Right word, scaling', ...
    'Wrong word, no scaling', 'Wrong word, scaling', ...
    'Fizzle below', 'Location', 'northwest');
title('Part f: Frequency scaling on and off');
grid on;
