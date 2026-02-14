import React, { useEffect, useState } from 'react';

interface ExecutionStep {
  id: number;
  text: string;
  status: 'pending' | 'active' | 'complete';
}

interface AgenticLoadingOverlayProps {
  headerText?: string;
  processingComplete?: boolean;
  currentFile?: number;
  totalFiles?: number;
}

const EXECUTION_STEPS = [
  'Analyzing file topology...',
  'Preserving document formatting...',
  'Mapping semantic text nodes...',
  'Extracting structured content...',
];

const HEADER_STATES = [
  'Initializing Docling Engine...',
  'Structuring Legal Data...',
  'Finalizing Document Model...',
];

export const AgenticLoadingOverlay: React.FC<AgenticLoadingOverlayProps> = ({ 
  headerText = 'Converting Documents',
  processingComplete = false,
  currentFile = 0,
  totalFiles = 0,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [header, setHeader] = useState(HEADER_STATES[0]);
  const [steps, setSteps] = useState<ExecutionStep[]>(
    EXECUTION_STEPS.map((text, index) => ({
      id: index,
      text,
      status: index === 0 ? 'active' : 'pending',
    }))
  );

  useEffect(() => {
    // Timing sequence for the animation cascade (steps 0-2)
    const timings = [1200, 1400, 1600]; // Milliseconds for each step
    
    // Only auto-progress through the first 3 steps
    if (currentStepIndex >= 3) return;

    const timer = setTimeout(() => {
      // Mark current step as complete
      setSteps(prev => prev.map((step, idx) => {
        if (idx === currentStepIndex) {
          return { ...step, status: 'complete' };
        }
        if (idx === currentStepIndex + 1) {
          return { ...step, status: 'active' };
        }
        return step;
      }));

      // Update header text based on progress
      const nextIndex = currentStepIndex + 1;
      if (nextIndex < EXECUTION_STEPS.length) {
        const headerIndex = Math.min(Math.floor(nextIndex / 2), HEADER_STATES.length - 1);
        setHeader(HEADER_STATES[headerIndex]);
      }

      setCurrentStepIndex(prev => prev + 1);
    }, timings[currentStepIndex] || 1400);

    return () => clearTimeout(timer);
  }, [currentStepIndex]);

  // Separate effect to handle the final step completion based on actual processing
  useEffect(() => {
    if (processingComplete && currentStepIndex >= 3) {
      // Mark the final step as complete when processing is actually done
      setSteps(prev => prev.map((step, idx) => {
        if (idx === 3) {
          return { ...step, status: 'complete' };
        }
        return step;
      }));
    }
  }, [processingComplete, currentStepIndex]);

  return (
    <div className="absolute inset-0 z-50 bg-[#F5F4F0]/90 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
      <div 
        className="bg-white p-10 rounded-2xl shadow-elevated border border-[#E5E7EB] flex flex-col max-w-xl w-full mx-4 animate-in slide-in-from-bottom-4 duration-500"
        style={{ 
          animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
          minHeight: '280px'
        }}
      >
        {/* Header */}
        <h3 
          className="text-xl font-bold text-[#1C1C1C] mb-6 font-serif transition-all duration-500"
          style={{ 
            animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {header}
        </h3>

        {/* Execution Log */}
        <div className="space-y-3">
          {steps.map((step, index) => (
            <ExecutionLogItem 
              key={step.id} 
              step={step} 
              isVisible={index <= currentStepIndex}
              showProgress={index === 3 && step.status === 'active' && totalFiles > 0}
              currentFile={currentFile}
              totalFiles={totalFiles}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface ExecutionLogItemProps {
  step: ExecutionStep;
  isVisible: boolean;
  showProgress?: boolean;
  currentFile?: number;
  totalFiles?: number;
}

const ExecutionLogItem: React.FC<ExecutionLogItemProps> = ({ 
  step, 
  isVisible, 
  showProgress = false,
  currentFile = 0,
  totalFiles = 0,
}) => {
  return (
    <div 
      className={`flex items-center gap-3 transition-all duration-500 ${
        isVisible 
          ? 'opacity-100 translate-y-0' 
          : 'opacity-0 translate-y-2'
      }`}
      style={{ 
        animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        transitionDelay: isVisible ? '50ms' : '0ms'
      }}
    >
      {/* Status Indicator */}
      <div className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
        {step.status === 'pending' && (
          <div className="w-1.5 h-1.5 rounded-full bg-[#DDD9D0]" />
        )}
        
        {step.status === 'active' && (
          <>
            {/* Pulsing dot for active state */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-[#4A5A7B] animate-ping opacity-40" />
            </div>
            <div className="relative w-2 h-2 rounded-full bg-[#4A5A7B]" />
          </>
        )}
        
        {step.status === 'complete' && (
          <div className="w-4 h-4 flex items-center justify-center">
            <svg 
              className="w-4 h-4 text-[#4A5A7B]" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                d="M5 13l4 4L19 7" 
              />
            </svg>
          </div>
        )}
      </div>

      {/* Text */}
      <p 
        className={`text-[13px] leading-relaxed tracking-wide transition-colors duration-500 ${
          step.status === 'complete' 
            ? 'text-[#1C1C1C] font-medium' 
            : step.status === 'active'
            ? 'text-[#4A5A7B] font-medium'
            : 'text-[#9CA3AF]'
        }`}
        style={{ 
          letterSpacing: '0.01em',
        }}
      >
        {step.text}
        
        {/* Show processing progress for the final step */}
        {showProgress && currentFile > 0 && totalFiles > 0 && (
          <span className="ml-2 text-[#8A8470] font-normal">
            ({currentFile}/{totalFiles})
          </span>
        )}
        
        {/* Scanning shimmer effect for active state */}
        {step.status === 'active' && (
          <span className="inline-block ml-2 relative overflow-hidden w-12 h-0.5 align-middle">
            <span 
              className="absolute inset-0 bg-gradient-to-r from-transparent via-[#4A5A7B] to-transparent"
              style={{
                animation: 'shimmer 1.5s infinite',
              }}
            />
          </span>
        )}
      </p>
    </div>
  );
};

// Add shimmer animation to global styles
const style = document.createElement('style');
style.textContent = `
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
`;
document.head.appendChild(style);
