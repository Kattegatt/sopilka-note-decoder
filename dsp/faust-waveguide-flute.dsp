declare name "Sopilka Waveguide Flute";
declare description "Nonlinear waveguide flute, adapted as a folk-pipe comparison model";
declare author "Romain Michon (rmichon@ccrma.stanford.edu), adapted for Sopilka Note Decoder";
declare copyright "Romain Michon";
declare version "1.0";
declare licence "STK-4.3";
declare isInstrument "true";

import("instruments.lib");

freq = nentry("h:Basic_Parameters/freq [1][unit:Hz]", 440, 20, 20000, 1);
gain = nentry("h:Basic_Parameters/gain [1]", 1, 0, 1, 0.01);
gate = button("h:Basic_Parameters/gate [1]") : int;

pressure = hslider("h:Physical_and_Nonlinearity/v:Physical_Parameters/Pressure [2]", 0.9, 0, 1.5, 0.01) : si.smoo;
breathAmp = hslider("h:Physical_and_Nonlinearity/v:Physical_Parameters/Noise_Gain [2]", 0.1, 0, 1, 0.01) / 10;

typeModulation = nentry("h:Physical_and_Nonlinearity/v:Nonlinear_Filter_Parameters/Modulation_Type [3]", 0, 0, 4, 1);
nonLinearity = hslider("h:Physical_and_Nonlinearity/v:Nonlinear_Filter_Parameters/Nonlinearity [3]", 0, 0, 1, 0.01);
frequencyMod = hslider("h:Physical_and_Nonlinearity/v:Nonlinear_Filter_Parameters/Modulation_Frequency [3][unit:Hz]", 220, 20, 1000, 0.1);
nonLinAttack = hslider("h:Physical_and_Nonlinearity/v:Nonlinear_Filter_Parameters/Nonlinearity_Attack [3][unit:s]", 0.1, 0, 2, 0.01);

vibratoFreq = hslider("h:Envelopes_and_Vibrato/v:Vibrato_Parameters/Vibrato_Freq [4][unit:Hz]", 5, 1, 15, 0.1);
vibratoGain = hslider("h:Envelopes_and_Vibrato/v:Vibrato_Parameters/Vibrato_Gain [4]", 0.1, 0, 1, 0.01);
vibratoBegin = hslider("h:Envelopes_and_Vibrato/v:Vibrato_Parameters/Vibrato_Begin [4][unit:s]", 0.1, 0, 2, 0.01);
vibratoAttack = hslider("h:Envelopes_and_Vibrato/v:Vibrato_Parameters/Vibrato_Attack [4][unit:s]", 0.5, 0, 2, 0.01);
vibratoRelease = hslider("h:Envelopes_and_Vibrato/v:Vibrato_Parameters/Vibrato_Release [4][unit:s]", 0.2, 0, 2, 0.01);

pressureEnvelope = checkbox("h:Envelopes_and_Vibrato/v:Pressure_Envelope_Parameters/Pressure_Env [5]") : int;
env1Attack = hslider("h:Envelopes_and_Vibrato/v:Pressure_Envelope_Parameters/Press_Env_Attack [5][unit:s]", 0.05, 0, 2, 0.01);
env1Decay = hslider("h:Envelopes_and_Vibrato/v:Pressure_Envelope_Parameters/Press_Env_Decay [5][unit:s]", 0.2, 0, 2, 0.01);
env1Release = hslider("h:Envelopes_and_Vibrato/v:Pressure_Envelope_Parameters/Press_Env_Release [5][unit:s]", 1, 0, 2, 0.01);

env2Attack = hslider("h:Envelopes_and_Vibrato/v:Global_Envelope_Parameters/Glob_Env_Attack [6][unit:s]", 0.1, 0, 2, 0.01);
env2Release = hslider("h:Envelopes_and_Vibrato/v:Global_Envelope_Parameters/Glob_Env_Release [6][unit:s]", 0.1, 0, 2, 0.01);

nlfOrder = 6;
envelopeMod = en.asr(nonLinAttack, 1, 0.1, gate);
NLFM = nonLinearModulator((nonLinearity : si.smoo), envelopeMod, freq, typeModulation, (frequencyMod : si.smoo), nlfOrder);

feedBack1 = 0.4;
feedBack2 = 0.4;
embouchureDelayLength = (ma.SR / freq) / 2 - 2;
boreDelayLength = ma.SR / freq - 2;
embouchureDelay = de.fdelay(4096, embouchureDelayLength);
boreDelay = de.fdelay(4096, boreDelayLength);
poly = _ <: _ - _ * _ * _;
reflexionFilter = fi.lowpass(1, 2000);
stereo = stereoizer(ma.SR / freq);

env1 = en.adsr(env1Attack, env1Decay, 0.9, env1Release, (gate | pressureEnvelope)) * pressure * 1.1;
env2 = en.asr(env2Attack, 1, env2Release, gate) * 0.5;
vibratoEnvelope = envVibrato(vibratoBegin, vibratoAttack, 100, vibratoRelease, gate) * vibratoGain;
vibrato = os.osc(vibratoFreq) * vibratoEnvelope;
breath = no.noise * env1;
flow = env1 + breath * breathAmp + vibrato;

process = (_ <: (flow + *(feedBack1) : embouchureDelay : poly) + *(feedBack2) : reflexionFilter)
    ~ (boreDelay : NLFM) : *(env2) * gain : stereo : instrReverb;
