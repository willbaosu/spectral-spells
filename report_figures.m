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

% Test results from node tests/run_tests.js
spells = {'Fireball', 'Focus', 'Lightning Bolt', 'Shield'};
rightRho = [0.75 0.80 0.71 0.90];
wrongRho = [0.42 0.46 0.44 0.55];

% Part d: right word vs wrong word
figure('Position', [100 100 600 400]);
bar([rightRho' wrongRho']);
hold on;
plot([0.5 4.5], [0.5 0.5], 'r--', 'LineWidth', 1.5);
plot([0.5 4.5], [0.8 0.8], 'g--', 'LineWidth', 1.5);
set(gca, 'XTick', 1:4, 'XTickLabel', spells);
ylim([0 1.3]);
ylabel('Average peak \rho');
legend('Said this spell', 'Said another spell', ...
    'Fizzle below', 'Full power above', ...
    'Location', 'northwest');
title('Part d: Scores on six new voices');
grid on;

% Part e: score vs background noise
snr = [40 30 20 15 10 5 0];
withNR = [0.76 0.77 0.75 0.74 0.71 0.66 0.61];
bpOnly = [0.77 0.75 0.72 0.70 0.64 0.59 0.53];
wrongW = [0.48 0.48 0.46 0.45 0.44 0.41 0.38];
figure('Position', [100 100 600 400]);
plot(snr, withNR, 'o-', 'LineWidth', 1.5);
hold on;
plot(snr, bpOnly, 's-', 'LineWidth', 1.5);
plot(snr, wrongW, '^-', 'LineWidth', 1.5);
plot([0 40], [0.5 0.5], 'r--', 'LineWidth', 1.5);
set(gca, 'XDir', 'reverse');
xlabel('Voice power / noise power (dB)');
ylabel('Average peak \rho');
legend('Right word, noise removal', ...
    'Right word, bandpass only', 'Wrong word', ...
    'Fizzle below', 'Location', 'southwest');
title('Part e: Score vs background noise');
grid on;
