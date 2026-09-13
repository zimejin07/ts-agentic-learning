/**
 * Ink UI for the streaming agent.
 *
 * Token deltas are buffered and flushed every ~50ms. Rendering every single
 * token would flood React state updates and stall the event loop — the buffer
 * is the CLI-side half of backpressure. The other half is the async iterator
 * in AnthropicLlmClient.stream, which pauses the HTTP body when we don't pull.
 *
 * Side-effecting tools pause here: y/n (or `--yes`) before book_flight runs.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { runAgent } from '../agent/loop.js';
import { tools } from '../tools/index.js';
import type { AnthropicLlmClient } from '../agent/anthropic-client.js';
import type { ApprovalRequest, TraceEvent } from '../types/index.js';

const TOKEN_FLUSH_MS = 50;

export interface AppProps {
  goal: string;
  model: string;
  maxIterations: number;
  client: AnthropicLlmClient;
  abortSignal: AbortSignal;
  autoApprove: boolean;
}

export function App(props: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [liveTokens, setLiveTokens] = useState('');
  const [plan, setPlan] = useState('');
  const [traceLines, setTraceLines] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'running' | 'done' | 'aborted' | 'error'>('running');
  const [errorMessage, setErrorMessage] = useState('');
  const [hitCap, setHitCap] = useState(false);
  const [approvalPrompt, setApprovalPrompt] = useState<string | null>(null);

  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const resolveApproval = useRef<((ok: boolean) => void) | null>(null);

  const flushTokens = () => {
    if (!bufferRef.current) return;
    const chunk = bufferRef.current;
    bufferRef.current = '';
    setLiveTokens((prev) => prev + chunk);
  };

  const onToken = (text: string) => {
    bufferRef.current += text;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushTokens();
    }, TOKEN_FLUSH_MS);
  };

  const decideApproval = (ok: boolean) => {
    resolveApproval.current?.(ok);
    resolveApproval.current = null;
    setApprovalPrompt(null);
  };

  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') decideApproval(true);
      else if (input === 'n' || input === 'N' || key.escape) decideApproval(false);
    },
    { isActive: approvalPrompt !== null },
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const onEvent = (event: TraceEvent) => {
      if (event.type === 'plan') setPlan(event.message);
      if (event.type === 'act') {
        setLiveTokens('');
        setTraceLines((lines) => [...lines, `[act]     ${event.message}`]);
      }
      if (event.type === 'observe') {
        setTraceLines((lines) => [...lines, `[observe] ${event.message}`]);
      }
      if (event.type === 'reflect') {
        setTraceLines((lines) => [...lines, `[reflect] ${event.message}`]);
      }
      if (event.type === 'warning') {
        setTraceLines((lines) => [...lines, `[warn]    ${event.message}`]);
      }
      if (event.type === 'approve') {
        setTraceLines((lines) => [...lines, `[approve] ${event.message}`]);
      }
    };

    const onApprove = async (request: ApprovalRequest): Promise<boolean> => {
      if (props.autoApprove) return true;
      return new Promise<boolean>((resolve, reject) => {
        if (props.abortSignal.aborted) {
          reject(new Error('Aborted'));
          return;
        }
        const onAbort = () => {
          resolveApproval.current = null;
          setApprovalPrompt(null);
          reject(new Error('Aborted'));
        };
        props.abortSignal.addEventListener('abort', onAbort, { once: true });
        resolveApproval.current = (ok) => {
          props.abortSignal.removeEventListener('abort', onAbort);
          resolve(ok);
        };
        setApprovalPrompt(request.summary);
      });
    };

    void runAgent({
      goal: props.goal,
      client: props.client,
      tools,
      maxIterations: props.maxIterations,
      abortSignal: props.abortSignal,
      onEvent,
      onToken,
      onApprove,
    })
      .then((result) => {
        flushTokens();
        setAnswer(result.answer);
        setHitCap(result.hitMaxIterations || result.hitTokenBudget);
        setStatus('done');
        exit();
      })
      .catch((error: unknown) => {
        flushTokens();
        if (props.abortSignal.aborted || (error instanceof Error && error.message === 'Aborted')) {
          setStatus('aborted');
        } else {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
        exit();
      });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [exit, props]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" flexDirection="column" paddingX={1} marginBottom={1}>
        <Text bold color="cyan">
          Goal
        </Text>
        <Text>{props.goal}</Text>
        <Text dimColor>
          {props.model} · max {props.maxIterations} iterations
          {props.autoApprove ? ' · auto-approve' : ''} · Ctrl+C to abort
        </Text>
      </Box>

      {plan ? (
        <Box borderStyle="round" flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold color="cyan">
            Plan
          </Text>
          <Text>{plan}</Text>
        </Box>
      ) : (
        <Text dimColor>Planning…</Text>
      )}

      {liveTokens ? (
        <Box borderStyle="round" flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold color="yellow">
            Live tokens
          </Text>
          <Text>{liveTokens}</Text>
        </Box>
      ) : null}

      {traceLines.length > 0 ? (
        <Box borderStyle="round" flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold color="magenta">
            Trace
          </Text>
          {traceLines.slice(-12).map((line, index) => (
            <Text key={`${index}-${line.slice(0, 24)}`}>{line}</Text>
          ))}
        </Box>
      ) : null}

      {approvalPrompt ? (
        <Box
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="yellow">
            Approve booking? y / n
          </Text>
          <Text>{approvalPrompt}</Text>
        </Box>
      ) : null}

      {answer ? (
        <Box borderStyle="round" flexDirection="column" paddingX={1}>
          <Text bold color="green">
            Answer{hitCap ? ' (hit iteration cap)' : ''}
          </Text>
          <Text>{answer}</Text>
        </Box>
      ) : null}

      {status === 'aborted' ? <Text color="red">Aborted.</Text> : null}
      {status === 'error' ? <Text color="red">Error: {errorMessage}</Text> : null}
      {status === 'running' && !approvalPrompt ? <Text dimColor>Working…</Text> : null}
    </Box>
  );
}
