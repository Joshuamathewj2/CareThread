import { useState, useEffect, useRef } from 'react';
import { handleUserVoice } from './lib/agent';
import { mcpClient } from './lib/mcpClient';
import { Mic, MicOff, Send, Activity, Clock } from 'lucide-react';

export default function App() {
  const [member, setMember] = useState('m_priya');
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [orbState, setOrbState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [traces, setTraces] = useState<any[]>([]);
  const [log, setLog] = useState<{role: string, text: string}[]>([]);
  
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    mcpClient.onTrace = (trace) => {
      setTraces(prev => [trace, ...prev].slice(0, 20));
    };
    
    // Init speech recognition if available
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
  }, []);

  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
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
      const reply = await handleUserVoice(textToProcess, member);
      setLog(prev => [...prev, { role: 'agent', text: reply }]);
      setOrbState('speaking');
      
      // Speak it
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(reply);
        utterance.onend = () => setOrbState('idle');
        window.speechSynthesis.speak(utterance);
      } else {
        setTimeout(() => setOrbState('idle'), 2000);
      }
    } catch (err: any) {
      console.error(err);
      setLog(prev => [...prev, { role: 'agent', text: 'Error connecting to MCP.' }]);
      setOrbState('idle');
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-800">
      
      {/* LEFT: Alexa Visual Simulator */}
      <div className="w-1/3 flex flex-col items-center justify-center border-r border-slate-200 bg-white p-8 relative">
        <div className="absolute top-4 left-4 flex gap-2">
          <select 
            className="text-sm bg-slate-100 border border-slate-200 rounded p-1"
            value={member} 
            onChange={e => setMember(e.target.value)}
          >
            <option value="m_priya">Priya (Primary)</option>
            <option value="m_arjun">Arjun (Family)</option>
            <option value="m_meera">Meera (Aide)</option>
            <option value="m_guest">Guest (Viewer)</option>
          </select>
        </div>
        
        {/* Voice Orb */}
        <div className={`w-40 h-40 rounded-full flex items-center justify-center transition-all duration-500 shadow-xl
          ${orbState === 'idle' ? 'bg-blue-50' : ''}
          ${orbState === 'listening' ? 'bg-blue-200 scale-110 animate-pulse' : ''}
          ${orbState === 'thinking' ? 'bg-amber-100 border-4 border-amber-300 border-t-amber-500 animate-spin' : ''}
          ${orbState === 'speaking' ? 'bg-blue-400 shadow-blue-300 scale-105' : ''}
        `}>
          {orbState === 'idle' && <span className="text-blue-500 font-medium">Alexa+</span>}
          {orbState === 'listening' && <Mic className="w-10 h-10 text-blue-700" />}
        </div>
        
        <div className="mt-8 w-full">
          <div className="flex gap-2">
            <input 
              type="text" 
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend(inputText)}
              placeholder="Or type here..."
              className="flex-1 p-2 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            />
            <button onClick={() => handleSend(inputText)} className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              <Send className="w-5 h-5" />
            </button>
            <button onClick={toggleListen} className={`p-2 rounded text-white ${isListening ? 'bg-red-500' : 'bg-slate-400'}`}>
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Answer Card Preview (U-04) */}
        <div className="mt-8 w-full max-h-64 overflow-y-auto space-y-4">
          {log.map((entry, idx) => (
             <div key={idx} className={`p-4 rounded-lg ${entry.role === 'user' ? 'bg-slate-100 ml-8' : 'bg-blue-50 border border-blue-100 mr-8'}`}>
               <p className="text-sm font-medium mb-1">{entry.role === 'user' ? 'You' : 'CareThread'}</p>
               <p className="text-sm">{entry.text}</p>
             </div>
          ))}
        </div>
      </div>

      {/* MIDDLE: Timeline (U-05) */}
      <div className="w-1/3 flex flex-col border-r border-slate-200 bg-slate-50 relative overflow-hidden">
        <div className="p-4 bg-white border-b border-slate-200 font-semibold flex items-center gap-2 shadow-sm">
          <Clock className="w-5 h-5 text-slate-500" />
          Care Timeline
        </div>
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          <p className="text-slate-500 text-sm italic text-center mt-10">
            Timeline live-updates from SQLite not implemented in this MVP shell.<br/>
            (In a real app, this polls or uses SSE from the server).
          </p>
        </div>
      </div>

      {/* RIGHT: Trace Panel (U-06) */}
      <div className="w-1/3 flex flex-col bg-slate-900 text-slate-300 text-xs font-mono">
        <div className="p-4 border-b border-slate-800 font-semibold flex items-center gap-2 text-white">
          <Activity className="w-4 h-4" />
          MCP Tool Trace
        </div>
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {traces.length === 0 && <p className="text-slate-600">No tool calls yet...</p>}
          {traces.map((t, i) => (
            <div key={i} className="p-3 bg-slate-800 rounded border border-slate-700">
              <div className="flex justify-between text-blue-400 font-bold mb-2">
                <span>{t.tool}</span>
                <span className="text-slate-500">{t.time.substring(11,19)}</span>
              </div>
              <div className="mb-2">
                <span className="text-slate-500">Args: </span>
                {JSON.stringify(t.args, null, 2)}
              </div>
              {t.result && (
                <div className={`mt-2 p-2 rounded ${t.result.structuredContent?.safety?.level !== 'none' ? 'bg-amber-900/30 border border-amber-700/50 text-amber-200' : 'bg-slate-900'}`}>
                  <span className="text-slate-500">Result: </span>
                  {JSON.stringify(t.result.structuredContent, null, 2)}
                </div>
              )}
              {t.error && (
                <div className="mt-2 p-2 rounded bg-red-900/30 text-red-300">
                  <span className="text-red-500">Error: </span>
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
