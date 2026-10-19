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

  return (
    <div className="flex h-screen w-full bg-[#0E1720] font-sans text-slate-100 overflow-hidden">
      
      {/* LEFT: Alexa Visual Simulator */}
      <div className="w-1/3 flex flex-col border-r border-slate-800 bg-[#121D28] p-6 relative shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h1 className="font-semibold text-sm tracking-wide text-white uppercase">CareThread Voice Simulator</h1>
          </div>
          <select 
            className="text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 outline-none focus:border-emerald-500"
            value={member} 
            onChange={e => setMember(e.target.value)}
          >
            <option value="m_priya">Priya (Primary Caregiver)</option>
            <option value="m_arjun">Arjun (Family)</option>
            <option value="m_meera">Meera (Home Aide)</option>
            <option value="m_guest">Guest (Read-Only Viewer)</option>
          </select>
        </div>
        
        {/* Voice Orb Area */}
        <div className="flex flex-col items-center justify-center my-6">
          <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl relative
            ${orbState === 'idle' ? 'bg-gradient-to-tr from-emerald-600/30 to-teal-500/20 border border-emerald-500/40 shadow-emerald-950/50' : ''}
            ${orbState === 'listening' ? 'bg-gradient-to-tr from-cyan-500 to-blue-600 scale-110 shadow-cyan-500/40 animate-pulse' : ''}
            ${orbState === 'thinking' ? 'bg-gradient-to-tr from-amber-500 to-orange-600 border-4 border-amber-300 border-t-amber-100 animate-spin shadow-amber-500/40' : ''}
            ${orbState === 'speaking' ? 'bg-gradient-to-tr from-emerald-400 to-teal-500 scale-105 shadow-emerald-400/50 ring-4 ring-emerald-500/30' : ''}
          `}>
            {orbState === 'idle' && <span className="text-emerald-400 font-semibold text-sm tracking-wider">Alexa+</span>}
            {orbState === 'listening' && <Mic className="w-8 h-8 text-white animate-bounce" />}
            {orbState === 'speaking' && <Sparkles className="w-8 h-8 text-white" />}
          </div>
          <div className="mt-3 text-xs uppercase tracking-widest text-slate-400 font-medium">
            Status: <span className="text-emerald-400 font-semibold">{orbState}</span>
          </div>
        </div>

        {/* Input Controls */}
        <div className="w-full space-y-3">
          <div className="flex gap-2">
            <input 
              type="text" 
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend(inputText)}
              placeholder="Speak or type caregiver command..."
              className="flex-1 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button 
              onClick={() => handleSend(inputText)} 
              className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors cursor-pointer"
              title="Send Command"
            >
              <Send className="w-4 h-4" />
            </button>
            <button 
              onClick={toggleListen} 
              className={`p-2.5 rounded-lg text-white transition-colors cursor-pointer ${isListening ? 'bg-red-500 animate-pulse' : 'bg-slate-700 hover:bg-slate-600'}`}
              title="Toggle Microphone"
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>

          {/* Quick Preset Buttons for Demo */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {demoPhrases.map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(p.text)}
                className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 rounded border border-slate-700/60 transition cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Answer Cards Conversation Log */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1 text-sm border-t border-slate-800 pt-3">
          {log.length === 0 && (
            <p className="text-slate-500 text-xs italic text-center mt-6">
              Try clicking a quick scenario above or speaking a command to test the MCP safety guardrails.
            </p>
          )}
          {log.map((entry, idx) => {
            const isUser = entry.role === 'user';
            const isRedFlag = entry.safety?.level === 'emergency' || entry.safety?.level === 'contact_clinician';
            const isCaution = entry.safety?.level === 'caution';

            return (
              <div 
                key={idx} 
                className={`p-3 rounded-lg border leading-relaxed ${
                  isUser 
                    ? 'bg-slate-800/60 border-slate-700/60 ml-6 text-slate-200' 
                    : isRedFlag
                    ? 'bg-red-950/40 border-red-800 text-red-100 mr-4'
                    : isCaution
                    ? 'bg-amber-950/40 border-amber-800 text-amber-100 mr-4'
                    : 'bg-emerald-950/20 border-emerald-800/50 text-emerald-100 mr-4'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-1 opacity-80">
                  <span>{isUser ? 'Caregiver' : 'CareThread (Alexa+)'}</span>
                  {!isUser && isRedFlag && (
                    <span className="flex items-center gap-1 text-red-400 font-bold">
                      <ShieldAlert className="w-3.5 h-3.5" /> ESCALATION
                    </span>
                  )}
                  {!isUser && isCaution && (
                    <span className="flex items-center gap-1 text-amber-400 font-bold">
                      <AlertTriangle className="w-3.5 h-3.5" /> DOSE CAUTION
                    </span>
                  )}
                </div>
                <p>{entry.text}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* MIDDLE: Live Care Timeline (U-05) */}
      <div className="w-1/3 flex flex-col border-r border-slate-800 bg-[#0F1823] relative overflow-hidden">
        <div className="p-4 bg-[#14202D] border-b border-slate-800 font-semibold flex items-center justify-between text-white text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            <span>Today's Care Timeline</span>
          </div>
          <button 
            onClick={refreshTimeline}
            className="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-700 transition cursor-pointer"
          >
            Refresh
          </button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {timeline.length === 0 && (
            <p className="text-slate-500 text-xs text-center mt-12">
              No timeline events recorded yet today.
            </p>
          )}
          {timeline.map((ev, i) => {
            const timeStr = new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={i} className="p-3 bg-slate-900/90 rounded-lg border border-slate-800 hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className={`px-2 py-0.5 rounded font-medium text-[10px] uppercase tracking-wider ${
                    ev.type === 'dose' ? 'bg-blue-900/50 text-blue-300 border border-blue-800' :
                    ev.type === 'vital' ? 'bg-purple-900/50 text-purple-300 border border-purple-800' :
                    ev.type === 'redflag' ? 'bg-red-900/50 text-red-300 border border-red-800' :
                    'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}>
                    {ev.type}
                  </span>
                  <span className="text-slate-400 text-[11px]">{timeStr}</span>
                </div>
                <div className="text-sm font-medium text-slate-100">{ev.title}</div>
                <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                  <span>Logged by {ev.member}</span>
                  {ev.status && <span className="capitalize text-emerald-400">{ev.status}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: MCP Tool Trace Panel (U-06) */}
      <div className="w-1/3 flex flex-col bg-[#0A1017] text-slate-300 text-xs font-mono">
        <div className="p-4 bg-[#0E1721] border-b border-slate-800 font-semibold flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>MCP Tool Trace & Protocol</span>
          </div>
          <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded font-mono">
            PORT 3001
          </span>
        </div>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {traces.length === 0 && <p className="text-slate-600 text-xs italic">Waiting for MCP tool calls...</p>}
          {traces.map((t, i) => (
            <div key={i} className="p-3 bg-slate-900/80 rounded border border-slate-800">
              <div className="flex justify-between items-center text-emerald-400 font-bold mb-1.5">
                <span>{t.tool}</span>
                <span className="text-slate-500 font-normal text-[10px]">{t.time.substring(11, 19)} UTC</span>
              </div>
              <div className="mb-2 text-[11px]">
                <span className="text-slate-500">Arguments: </span>
                <pre className="text-slate-300 bg-slate-950/60 p-1.5 rounded overflow-x-auto mt-0.5">
                  {JSON.stringify(t.args, null, 2)}
                </pre>
              </div>
              {t.result && (
                <div className={`mt-1.5 p-2 rounded text-[11px] ${
                  t.result.structuredContent?.safety?.level === 'emergency' 
                    ? 'bg-red-950/40 border border-red-700/60 text-red-200' 
                    : t.result.structuredContent?.safety?.level === 'caution'
                    ? 'bg-amber-950/40 border border-amber-700/60 text-amber-200'
                    : 'bg-slate-950/60 border border-slate-800 text-slate-300'
                }`}>
                  <div className="flex items-center gap-1 font-semibold mb-1">
                    <CheckCircle className="w-3 h-3 text-emerald-400" />
                    <span>Response Structured Content:</span>
                  </div>
                  <pre className="overflow-x-auto text-[10px]">
                    {JSON.stringify(t.result.structuredContent, null, 2)}
                  </pre>
                </div>
              )}
              {t.error && (
                <div className="mt-1.5 p-2 rounded bg-red-950/50 border border-red-800 text-red-300">
                  <span className="text-red-400 font-bold">Error: </span>
                  {t.error.message}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
