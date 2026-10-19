import { useState, useEffect, useRef } from 'react';
import { handleUserVoice } from './lib/agent';
import { mcpClient } from './lib/mcpClient';
import { Mic, MicOff, Send, Activity, Clock, ShieldAlert, Sparkles, CheckCircle, AlertTriangle } from 'lucide-react';

interface TimelineEvent {
  id: string;
  type: 'dose' | 'observation' | 'vital' | 'redflag';
  title: string;
  member: string;
  at: string;
  status?: string;
  severity?: number;
  in_range?: number;
}

export default function App() {
  const [member, setMember] = useState('m_priya');
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [orbState, setOrbState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [traces, setTraces] = useState<any[]>([]);
  const [log, setLog] = useState<{ role: string; text: string; safety?: any }[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  
  const recognitionRef = useRef<any>(null);

  // Load timeline from MCP resource
  const refreshTimeline = async () => {
    try {
      await mcpClient.connect(member);
      const res = await mcpClient.readResource('carethread://circle/c_1/log/today');
      const firstContent = res?.contents?.[0];
      if (firstContent && 'text' in firstContent && typeof firstContent.text === 'string') {
        const events = JSON.parse(firstContent.text);
        setTimeline(events);
      }
    } catch (e) {
      // Fallback: silently ignore if server still initializing
    }
  };

  useEffect(() => {
    mcpClient.onTrace = (trace) => {
      setTraces(prev => [trace, ...prev].slice(0, 30));
      // Refresh timeline on any write tool trace
      if (['med_log_given', 'log_observation', 'log_vital', 'med_schedule_set'].includes(trace.tool)) {
        setTimeout(refreshTimeline, 300);
      }
    };

    refreshTimeline();
    
    // Init browser speech recognition if supported
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        handleSend(transcript);
      };
      
      recognitionRef.current.onend = () => {
        setIsListening(false);
        if (orbState === 'listening') setOrbState('idle');
      };
    }
  }, [member]);

  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setOrbState('idle');
    } else {
      setOrbState('listening');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleSend = async (textToProcess: string) => {
    if (!textToProcess.trim()) return;
    
    setLog(prev => [...prev, { role: 'user', text: textToProcess }]);
    setInputText('');
    setOrbState('thinking');
    
    try {
      const { text: reply, safety } = await handleUserVoice(textToProcess, member);

      setLog(prev => [...prev, { role: 'agent', text: reply, safety }]);
      setOrbState('speaking');
      
      // Web speech synthesis
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(reply);
        utterance.rate = 1.05;
        utterance.onend = () => setOrbState('idle');
        utterance.onerror = () => setOrbState('idle');
        window.speechSynthesis.speak(utterance);
      } else {
        setTimeout(() => setOrbState('idle'), 2500);
      }

      refreshTimeline();
    } catch (err: any) {
      console.error(err);
      setLog(prev => [...prev, { role: 'agent', text: 'Error communicating with CareThread MCP server.' }]);
      setOrbState('idle');
    }
  };

  const demoPhrases = [
    { label: "Give Metformin", text: "I just gave Dad his Metformin" },
    { label: "Check Status", text: "Did anyone give Metformin today?" },
    { label: "Full Checklist", text: "What is the medication checklist for today?" },
    { label: "Stroke Red Flag", text: "His speech is a bit slurred and face is drooping" },
    { label: "Chest Pain Red Flag", text: "He is complaining of tight chest pain" },
    { label: "Log Blood Pressure", text: "Blood pressure is 125 over 82" },
    { label: "Doctor Question", text: "Ask the doctor about reducing his blood pressure pill" },
    { label: "Handoff Summary", text: "Give me the handoff summary for today" }
  ];

  const orbLabel: Record<typeof orbState, string> = {
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking'
  };

  const typeStyle = (type: string) =>
    type === 'dose' ? 'bg-thread-soft text-thread' :
    type === 'vital' ? 'bg-[#E6E9F7] text-[#3B4A9C]' :
    type === 'redflag' ? 'bg-urgent-soft text-urgent' :
    'bg-[#EFEBDF] text-[#6B5A22]';

  const typeStripe = (type: string) =>
    type === 'dose' ? 'bg-thread' :
    type === 'vital' ? 'bg-[#5A6BD0]' :
    type === 'redflag' ? 'bg-urgent' :
    'bg-[#B79A3A]';

  const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-thread';

  return (
    <div className="flex h-screen w-full bg-porcelain font-sans text-ink overflow-hidden">

      {/* LEFT: Voice simulator */}
      <section className="w-1/3 min-w-[340px] flex flex-col bg-panel border-r border-line p-6 relative" aria-label="Voice simulator">
        <header className="flex items-center justify-between gap-3 pb-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-thread text-white">
              <Sparkles className="w-4 h-4" />
            </span>
            <h1 className="font-display font-bold text-lg leading-none tracking-tight">CareThread</h1>
          </div>
          <select
            aria-label="Speaking as"
            className={`text-sm bg-porcelain border border-line text-ink rounded-lg px-2.5 py-1.5 cursor-pointer ${focusRing}`}
            value={member}
            onChange={e => setMember(e.target.value)}
          >
            <option value="m_priya">Priya (Primary Caregiver)</option>
            <option value="m_arjun">Arjun (Family)</option>
            <option value="m_meera">Meera (Home Aide)</option>
            <option value="m_guest">Guest (Read-Only Viewer)</option>
          </select>
        </header>

        {/* Voice orb */}
        <div className="flex flex-col items-center justify-center my-7">
          <div className="relative w-36 h-36 grid place-items-center">
            <span
              aria-hidden
              className={`absolute inset-0 rounded-full border-[3px] transition-colors duration-300
                ${orbState === 'idle' ? 'border-thread-soft' : ''}
                ${orbState === 'listening' ? 'border-thread ring-listening' : ''}
                ${orbState === 'thinking' ? 'border-line border-t-caution ring-thinking' : ''}
                ${orbState === 'speaking' ? 'border-thread' : ''}`}
            />
            <div className={`w-28 h-28 rounded-full grid place-items-center transition-all duration-300
              ${orbState === 'idle' ? 'bg-thread-soft text-thread' : ''}
              ${orbState === 'listening' ? 'bg-thread text-white' : ''}
              ${orbState === 'thinking' ? 'bg-caution-soft text-caution' : ''}
              ${orbState === 'speaking' ? 'bg-thread text-white shadow-[0_0_0_8px_var(--color-thread-soft)]' : ''}`}>
              {orbState === 'listening' ? <Mic className="w-8 h-8" /> :
               orbState === 'speaking' ? <Sparkles className="w-8 h-8" /> :
               <span className="font-display font-bold text-xl tracking-tight">Alexa+</span>}
            </div>
          </div>
          <div className="mt-3 text-sm text-ink-soft" aria-live="polite">
            <span className="font-bold text-thread">{orbLabel[orbState]}</span>
          </div>
        </div>

        {/* Input controls */}
        <div className="w-full space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend(inputText)}
              placeholder="Speak or type a caregiver command..."
              className={`flex-1 min-w-0 px-3.5 py-2.5 bg-porcelain border border-line rounded-xl text-sm text-ink placeholder:text-ink-soft/70 ${focusRing}`}
            />
            <button
              onClick={() => handleSend(inputText)}
              className={`px-3.5 bg-thread hover:bg-[#185A53] text-white rounded-xl transition-colors cursor-pointer ${focusRing}`}
              title="Send Command"
              aria-label="Send command"
            >
              <Send className="w-4 h-4" />
            </button>
            <button
              onClick={toggleListen}
              className={`px-3.5 rounded-xl transition-colors cursor-pointer ${focusRing} ${isListening ? 'bg-urgent text-white ring-listening' : 'bg-thread-soft text-thread hover:bg-[#C8E3DD]'}`}
              title="Toggle Microphone"
              aria-label="Toggle microphone"
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>

          {/* Quick scenarios */}
          <div className="flex flex-wrap gap-1.5">
            {demoPhrases.map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(p.text)}
                className={`text-xs bg-porcelain hover:bg-thread-soft text-ink-soft hover:text-thread px-2.5 py-1.5 rounded-full border border-line transition-colors cursor-pointer ${focusRing}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation */}
        <div className="mt-5 flex-1 overflow-y-auto space-y-3 pr-1 text-sm border-t border-line pt-4">
          {log.length === 0 && (
            <p className="text-ink-soft text-sm text-center mt-6 max-w-[28ch] mx-auto leading-relaxed">
              Pick a scenario above or say a command to see CareThread's safety checks at work.
            </p>
          )}
          {log.map((entry, idx) => {
            const isUser = entry.role === 'user';
            const isRedFlag = entry.safety?.level === 'emergency' || entry.safety?.level === 'contact_clinician';
            const isCaution = entry.safety?.level === 'caution';

            return (
              <div
                key={idx}
                className={`p-3.5 rounded-2xl leading-relaxed ${
                  isUser
                    ? 'bg-ink text-white ml-8 rounded-br-md'
                    : isRedFlag
                    ? 'bg-urgent-soft text-[#5C100C] border-l-4 border-urgent mr-4 rounded-bl-md'
                    : isCaution
                    ? 'bg-caution-soft text-[#4D3000] border-l-4 border-caution mr-4 rounded-bl-md'
                    : 'bg-thread-soft text-[#0F3D38] mr-4 rounded-bl-md'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold mb-1 opacity-80">
                  <span>{isUser ? 'Caregiver' : 'CareThread (Alexa+)'}</span>
                  {!isUser && isRedFlag && (
                    <span className="flex items-center gap-1 text-urgent">
                      <ShieldAlert className="w-3.5 h-3.5" /> Escalation
                    </span>
                  )}
                  {!isUser && isCaution && (
                    <span className="flex items-center gap-1 text-caution">
                      <AlertTriangle className="w-3.5 h-3.5" /> Dose caution
                    </span>
                  )}
                </div>
                <p>{entry.text}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* MIDDLE: Live care timeline */}
      <section className="w-1/3 min-w-[300px] flex flex-col border-r border-line relative overflow-hidden" aria-label="Care timeline">
        <header className="px-6 py-4 border-b border-line flex items-center justify-between bg-porcelain">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-thread" />
            <h2 className="font-display font-bold text-lg tracking-tight">Today's care timeline</h2>
          </div>
          <button
            onClick={refreshTimeline}
            className={`text-xs font-bold text-thread hover:bg-thread-soft px-3 py-1.5 rounded-full border border-thread/40 transition-colors cursor-pointer ${focusRing}`}
          >
            Refresh
          </button>
        </header>
        <div className="p-6 flex-1 overflow-y-auto">
          {timeline.length === 0 && (
            <p className="text-ink-soft text-sm text-center mt-16 max-w-[30ch] mx-auto leading-relaxed">
              Nothing logged yet today. Log a dose or a note and it appears here.
            </p>
          )}
          <ol className="relative space-y-3 before:content-[''] before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-line">
            {timeline.map((ev, i) => {
              const timeStr = new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <li key={i} className="relative pl-7">
                  <span className={`absolute left-0 top-4 w-[11px] h-[11px] rounded-full ring-4 ring-porcelain ${typeStripe(ev.type)}`} aria-hidden />
                  <div className="p-3.5 bg-panel rounded-xl border border-line hover:border-thread/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`px-2 py-0.5 rounded-full font-bold text-xs capitalize ${typeStyle(ev.type)}`}>
                        {ev.type}
                      </span>
                      <span className="text-ink-soft text-xs tabular-nums">{timeStr}</span>
                    </div>
                    <div className="text-sm font-bold text-ink">{ev.title}</div>
                    <div className="text-xs text-ink-soft mt-1 flex items-center justify-between">
                      <span>Logged by {ev.member}</span>
                      {ev.status && <span className="capitalize font-bold text-thread">{ev.status}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* RIGHT: MCP tool trace console */}
      <section className="w-1/3 min-w-[320px] flex flex-col bg-console text-[#C9D6D2] text-xs font-mono" aria-label="MCP tool trace">
        <header className="px-5 py-4 border-b border-console-line flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-[#5FD3C3]" />
            <h2 className="font-display font-bold text-lg tracking-tight">MCP tool trace</h2>
          </div>
          <span className="text-xs text-[#5FD3C3] border border-[#2F5A54] px-2 py-0.5 rounded-full">
            :3001/mcp
          </span>
        </header>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {traces.length === 0 && <p className="text-[#7F918C] text-xs">Waiting for MCP tool calls...</p>}
          {traces.map((t, i) => {
            const level = t.result?.structuredContent?.safety?.level;
            const urgent = level === 'emergency';
            const caution = level === 'caution';
            return (
              <div key={i} className={`p-3 bg-[#1E2A27] rounded-lg border-l-4 ${urgent ? 'border-[#FF7A70]' : caution ? 'border-[#F0B04A]' : 'border-[#5FD3C3]'}`}>
                <div className="flex justify-between items-center text-white font-semibold mb-2">
                  <span className="text-sm">{t.tool}</span>
                  <span className="text-[#7F918C] font-normal text-xs tabular-nums">{t.time.substring(11, 19)} UTC</span>
                </div>
                <div className="mb-2">
                  <span className="text-[#7F918C]">Arguments</span>
                  <pre className="text-[#C9D6D2] bg-console p-2 rounded-md overflow-x-auto mt-1">
                    {JSON.stringify(t.args, null, 2)}
                  </pre>
                </div>
                {t.result && (
                  <div className={`mt-1.5 p-2 rounded-md ${
                    urgent
                      ? 'bg-[#3A1B19] border border-[#7A332E] text-[#FFD4D0]'
                      : caution
                      ? 'bg-[#352A14] border border-[#7A5A1E] text-[#FFE3B0]'
                      : 'bg-console border border-console-line text-[#C9D6D2]'
                  }`}>
                    <div className="flex items-center gap-1.5 font-semibold mb-1">
                      <CheckCircle className="w-3 h-3 text-[#5FD3C3]" />
                      <span>Structured content</span>
                    </div>
                    <pre className="overflow-x-auto">
                      {JSON.stringify(t.result.structuredContent, null, 2)}
                    </pre>
                  </div>
                )}
                {t.error && (
                  <div className="mt-1.5 p-2 rounded-md bg-[#3A1B19] border border-[#7A332E] text-[#FFD4D0]">
                    <span className="font-bold">Error: </span>
                    {t.error.message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

    </div>
  );
}
