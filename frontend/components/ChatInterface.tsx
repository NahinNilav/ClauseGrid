import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, X, User } from 'lucide-react';
import { ChatMessage, DocumentFile, Column, ExtractionResult } from '../types';
import { analyzeDataWithChat } from '../services/geminiService';

interface ChatInterfaceProps {
  documents: DocumentFile[];
  columns: Column[];
  results: ExtractionResult;
  onClose: () => void;
  modelId: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  documents,
  columns,
  results,
  onClose,
  modelId
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      // Format history for Gemini
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const responseText = await analyzeDataWithChat(
        input,
        { documents, columns, results },
        history,
        modelId
      );

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "Sorry, I encountered an error processing your request.",
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
       <div className="p-4 border-b border-[#E5E7EB] flex items-center justify-between">
        <div className="flex items-center gap-3">
            <div className="p-1.5 bg-[#EFF1F5] rounded-lg text-[#4A5A7B]">
                <Bot className="w-5 h-5" />
            </div>
            <div>
                <h3 className="font-semibold text-[#1C1C1C] font-serif">Chat</h3>
                <p className="text-xs text-[#8A8470]">Ask questions about this spreadsheet</p>
            </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-[#F5F4F0] rounded-full text-[#A8A291] hover:text-black transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#FAFAF7]">
        {messages.length === 0 && (
           <div className="h-full flex flex-col items-center justify-center text-[#C4BFB3] space-y-2 opacity-60">
              <Bot className="w-12 h-12 mb-2" />
              <p className="text-sm text-center max-w-[200px]">Start a conversation to analyze your extracted data.</p>
           </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-[#1C1C1C] text-white' : 'bg-[#4A5A7B] text-white'}`}>
                 {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`p-3 rounded-2xl text-sm shadow-sm overflow-hidden ${
                msg.role === 'user' 
                  ? 'bg-[#1C1C1C] text-white rounded-tr-none' 
                  : 'bg-white border border-[#E5E7EB] text-[#333333] rounded-tl-none'
              }`}>
                <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.text}
                </div>
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
             <div className="flex gap-2 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-[#4A5A7B] text-white flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-[#E5E7EB] p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center space-x-1">
                <div className="w-2 h-2 bg-[#C4BFB3] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-[#C4BFB3] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-[#C4BFB3] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-white border-t border-[#E5E7EB]">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="e.g., Which side letter has the most favourable coinvestment clause?"
            className="w-full bg-[#F5F4F0] border border-[#E5E7EB] rounded-pill py-3 pl-4 pr-12 text-sm focus:ring-[3px] focus:ring-[rgba(74,90,123,0.15)] focus:border-[#4A5A7B] focus:bg-white transition-all placeholder:text-[#9CA3AF]"
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="absolute right-2 p-2 bg-[#1C1C1C] text-white rounded-full hover:bg-[#333333] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};