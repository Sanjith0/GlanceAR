import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Button, Icon, Notice, Portrait } from './components';
import type { Conversation, Profile } from './domain';
import { colors, fonts, s } from './theme';

/** Speaker 1 blue, Speaker 2 green, alternating after that. */
const speakerColors = [colors.green, colors.blue];
const timestamp = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export interface ConversationChatProps {
  conversation: Conversation;
  me: Profile;
  eventTitle?: string;
  demo: boolean;
  sending?: boolean;
  /** Resolve after the message is accepted; reject to preserve the draft. */
  onSend: (text: string) => Promise<void>;
  /** The owner guards navigation while a capture/upload is still settling. */
  onBack: () => void;
  /** Called only after the user explicitly confirms deletion for both people. */
  onDelete: () => Promise<void>;
  error?: string;
  /** Optional demo actor-view controls, never connection approvals. */
  previewControls?: React.ReactNode;
  /** Caller-owned upload progress, retained-audio retry, or other capture notice. */
  notice?: React.ReactNode;
}

const MAX_MESSAGE_LENGTH = 2_000;

/**
 * Full-height chat surface. Render directly inside the root safe area, not inside
 * Page's ScrollView. This component never navigates, records, or accesses app
 * context, so its owner can keep the capture controller mounted through upload.
 */
export function ConversationChat(props: ConversationChatProps) {
  // A demo actor switch must not expose the other person's unsent draft.
  return <ChatContent key={`${props.conversation.id}:${props.me.id}`} {...props} />;
}

function ChatContent({
  conversation, me, eventTitle, demo, sending = false, onSend, onBack, onDelete,
  error, previewControls, notice,
}: ConversationChatProps) {
  const [draft, setDraft] = useState('');
  const [operation, setOperation] = useState<'send' | 'delete' | null>(null);
  const [operationError, setOperationError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const working = useRef(false);
  const mounted = useRef(true);
  const atBottom = useRef(true);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const peer = conversation.participants.find(person => person.id !== me.id);
  const messages = conversation.messages ?? [];
  const closed = conversation.status === 'cancelled';
  const connected = Boolean(conversation.connectedAt) || conversation.status === 'shared';
  const trimmedDraft = draft.trim();
  const busy = sending || operation !== null;
  const canSend = connected && !closed && !busy && trimmedDraft.length > 0
    && trimmedDraft.length <= MAX_MESSAGE_LENGTH;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function send() {
    if (!canSend || working.current) return;
    working.current = true;
    setOperation('send');
    setOperationError('');
    try {
      await onSend(trimmedDraft);
      if (mounted.current) {
        setDraft('');
        atBottom.current = true;
        scroll.current?.scrollToEnd({ animated: true });
      }
    } catch (cause) {
      if (mounted.current) setOperationError(cause instanceof Error
        ? cause.message : 'Your message was not sent. Your draft is still here; please try again.');
    } finally {
      working.current = false;
      if (mounted.current) setOperation(null);
    }
  }

  async function deleteChat() {
    if (busy || working.current) return;
    working.current = true;
    setOperation('delete');
    setOperationError('');
    try {
      await onDelete();
      if (mounted.current) setConfirmDelete(false);
    } catch (cause) {
      if (mounted.current) setOperationError(cause instanceof Error
        ? cause.message : 'This conversation could not be deleted. Please try again.');
    } finally {
      working.current = false;
      if (mounted.current) setOperation(null);
    }
  }

  if (!peer) return <View style={[s.page, s.content]}>
    <Notice error>This conversation is unavailable.</Notice>
    <Button onPress={onBack}>Back to connections</Button>
  </View>;

  const recap = conversation.recap;
  const recapPending = !recap && ['ended', 'processing'].includes(conversation.status);

  return <KeyboardAvoidingView testID="conversation-chat" style={styles.frame}
    behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to connections" testID="chat-back"
        onPress={onBack} style={({ pressed }) => [styles.iconButton, pressed && s.pressed]}>
        <Icon name="arrow-left" />
      </Pressable>
      <Portrait person={peer} size={44} />
      <View style={styles.headerText}>
        <Text accessibilityRole="header" style={styles.peerName}>{peer.name}</Text>
        <Text style={s.small}>{connected && !closed ? 'Connected' : 'Conversation'}{eventTitle ? ` · ${eventTitle}` : ''}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Delete conversation"
        accessibilityState={{ disabled: busy || closed }} disabled={busy || closed}
        testID="chat-delete" onPress={() => {
          Keyboard.dismiss();
          setOperationError('');
          setConfirmDelete(true);
        }} style={({ pressed }) => [styles.iconButton, pressed && s.pressed]}>
        <Icon name="trash-2" color={busy || closed ? colors.muted : colors.ink} size={19} />
      </Pressable>
    </View>

    <ScrollView ref={scroll} style={styles.history} contentContainerStyle={styles.historyContent}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      testID="chat-history" scrollEventThrottle={100}
      onScroll={({ nativeEvent }) => {
        atBottom.current = nativeEvent.contentSize.height - nativeEvent.contentOffset.y
          - nativeEvent.layoutMeasurement.height < 100;
      }}
      onContentSizeChange={() => {
        if (messages.length > 0 && atBottom.current) scroll.current?.scrollToEnd({ animated: false });
      }}>
      {previewControls}
      {notice}
      {closed ? <Notice>This conversation has been deleted. Messaging is no longer available.</Notice> : <>
        <View style={styles.connectionLine}>
          <Icon name="check-circle" color={colors.green} size={16} />
          <Text style={[s.small, styles.flexText]}>You and {peer.name.split(' ')[0]} are connected.</Text>
        </View>
        <View style={styles.recapCard} testID="chat-recap">
          <View style={styles.recapHeading}>
            <Icon name={recap ? 'file-text' : recapPending ? 'clock' : 'info'} color={colors.blue} size={18} />
            <Text style={styles.recapLabel}>{recap?.source === 'sample' && demo
              ? 'SAMPLE RECAP · NOT TRANSCRIBED' : recap?.source === 'ai' ? 'SHARED AI RECAP' : 'SHARED RECAP'}</Text>
          </View>
          {recap ? <>
            <Text style={s.body}>{recap.summary}</Text>
            {recap.topics.length > 0 && <View style={styles.topics}>{recap.topics.map((topic, index) =>
              <View key={`${index}-${topic}`} style={styles.topic}><Text style={s.small}>{topic}</Text></View>
            )}</View>}
            {recap.nextSteps.length > 0 && <View style={styles.nextSteps}>
              <Text style={s.label}>Keep the conversation going</Text>
              {recap.nextSteps.map((step, index) => <View key={`${index}-${step}`} style={styles.nextStep}>
                <Icon name="arrow-up-right" color={colors.blue} size={16} />
                <Text style={[s.muted, styles.flexText]}>{step}</Text>
              </View>)}
            </View>}
            {recap.transcript && recap.transcript.length > 0 && <>
              <Button tone="ghost" icon={showTranscript ? 'chevron-up' : 'align-left'} testID="chat-transcript-toggle"
                onPress={() => setShowTranscript(!showTranscript)}>{showTranscript ? 'Hide transcript' : 'Show transcript'}</Button>
              {showTranscript && <View style={styles.transcript} testID="chat-transcript">
                {recap.transcript.map((turn, index) => <View key={`${index}-${turn.startMs}`} style={styles.turn}>
                  <Text style={[styles.speaker, { color: speakerColors[(Number(turn.speaker.replace(/\D/g, '')) || 1) % 2] }]}>
                    {`${turn.speaker} · ${timestamp(turn.startMs)}`}</Text>
                  <Text style={s.muted}>{turn.text}</Text>
                </View>)}
                <Text style={s.small}>Speaker numbers come from the recording’s voices, not from who you are.</Text>
              </View>}
            </>}
            <Text style={s.small}>{demo && recap.source === 'sample'
              ? 'This is a scripted example, not a transcription.'
              : 'The same recap is shared with both of you. AI can miss details; check anything important together.'}</Text>
          </> : recapPending ? <>
            <View style={s.row}><ActivityIndicator size="small" color={colors.blue} />
              <Text accessibilityRole="header" style={[s.label, styles.flexText]}>Your recap is on its way</Text></View>
            <Text style={s.muted}>You can message each other while your shared recap is prepared.</Text>
          </> : <>
            <Text accessibilityRole="header" style={s.label}>Recap unavailable.</Text>
            <Text style={s.muted}>Your conversation has ended. Nothing new will be recorded automatically. You can still message each other here.</Text>
            {conversation.error ? <Text style={[s.small, { color: colors.danger }]}>{conversation.error}</Text> : null}
          </>}
        </View>

        {messages.length === 0
          ? <Text style={styles.emptyMessages}>Keep the conversation going. Send the first message.</Text>
          : messages.map(message => {
            const mine = message.senderId === me.id;
            const sender = conversation.participants.find(person => person.id === message.senderId);
            return <View key={message.id} style={[styles.messageRow, mine && styles.myMessageRow]}
              testID={`chat-message-${message.id}`}>
              <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble]}>
                <Text style={[styles.messageMeta, mine && styles.myMessageMeta]}>
                  {mine ? 'You' : sender?.name ?? 'Participant'} · {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
                <Text selectable style={[styles.messageText, mine && styles.myMessageText]}>{message.text}</Text>
              </View>
            </View>;
          })}
      </>}
    </ScrollView>

    <View style={styles.footer}>
      {error || operationError ? <Notice error>{operationError || error}</Notice> : null}
      {confirmDelete ? <View style={styles.deletePanel} testID="chat-delete-confirmation">
        <Text style={s.label}>Delete for both participants?</Text>
        <Text style={s.small}>This chat and its shared recap will disappear for you and {peer.name}. This cannot be undone.</Text>
        <Button tone="danger" busy={operation === 'delete'} disabled={sending}
          testID="chat-confirm-delete" onPress={() => void deleteChat()}>Delete for both of us</Button>
        <Button tone="ghost" disabled={busy} onPress={() => {
          setConfirmDelete(false);
          setOperationError('');
        }}>Keep conversation</Button>
      </View> : <>
        <View style={styles.composer}>
          <TextInput value={draft} onChangeText={setDraft} multiline maxLength={MAX_MESSAGE_LENGTH}
            editable={connected && !closed && !busy}
            accessibilityLabel={`Message ${peer.name}`} accessibilityHint="Write a message, then choose Send message."
            placeholder={`Message ${peer.name.split(' ')[0]}`} placeholderTextColor={colors.muted}
            testID="chat-message-input" style={styles.messageInput}
            onFocus={() => { atBottom.current = true; scroll.current?.scrollToEnd({ animated: true }); }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend, busy: operation === 'send' || sending }}
            disabled={!canSend} onPress={() => void send()} testID="chat-send"
            style={({ pressed }) => [styles.sendButton, !canSend && styles.sendDisabled, pressed && s.pressed]}>
            {operation === 'send' || sending ? <ActivityIndicator color={colors.muted} size="small" />
              : <Icon name="arrow-up" color={canSend ? colors.paper : colors.muted} size={21} />}
          </Pressable>
        </View>
        <View style={styles.composerNotes}>
          <Text style={[s.small, styles.flexText]}>{demo ? 'Demo messages stay in this preview.' : 'Only the two of you can see this conversation.'}</Text>
          {draft.length >= MAX_MESSAGE_LENGTH - 200 && <Text style={s.small}>{draft.length}/{MAX_MESSAGE_LENGTH}</Text>}
        </View>
      </>}
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.paper,
  },
  headerText: { flex: 1, minWidth: 0, gap: 3 },
  peerName: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 17, lineHeight: 23 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  history: { flex: 1, minHeight: 0 },
  historyContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, gap: 18 },
  connectionLine: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  flexText: { flex: 1, minWidth: 0 },
  recapCard: { padding: 18, gap: 14, backgroundColor: colors.canvas, borderRadius: 18 },
  recapHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recapLabel: { flex: 1, color: colors.blue, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topic: { maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.paper, borderRadius: 8 },
  nextSteps: { gap: 10 },
  nextStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  transcript: { gap: 12, paddingTop: 4 },
  turn: { gap: 2 },
  speaker: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, letterSpacing: 0.3 },
  emptyMessages: { color: colors.muted, fontFamily: fonts.body, fontSize: 13, lineHeight: 20, textAlign: 'center', paddingVertical: 12 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  myMessageRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '88%', minWidth: 72, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, gap: 5 },
  myBubble: { backgroundColor: colors.blue, borderBottomRightRadius: 5 },
  theirBubble: { backgroundColor: colors.canvas, borderBottomLeftRadius: 5 },
  messageMeta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  myMessageMeta: { color: colors.paper },
  messageText: { color: colors.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  myMessageText: { color: colors.paper },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  messageInput: { flex: 1, minWidth: 0, minHeight: 46, maxHeight: 128, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.line, borderRadius: 18, fontFamily: fonts.body, fontSize: 15, lineHeight: 21,
    color: colors.ink, backgroundColor: colors.paper },
  sendButton: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.blue, justifyContent: 'center', alignItems: 'center' },
  sendDisabled: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
  composerNotes: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  deletePanel: { gap: 10 },
});
