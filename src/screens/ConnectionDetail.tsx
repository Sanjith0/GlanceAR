import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Chip, Empty, Icon, Page, SampleTag } from '../components';
import { colors, fonts, radius, s, type } from '../theme';
import { ConversationChat } from '../ConversationChat';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { formatEventDate, relativeDay, useConnection, useMe } from '../services/views';
import { buildSuggestion } from '../services/suggestions';
import { useDemoMode } from '../services/demoMode';
import { PersonSheet } from '../ui/PersonSheet';
import { DemoActors } from '../ui/shared';
import type { Conversation } from '../domain';
import type { ConnectionView } from '../services/views';
import type { ConnectionRecord, PersonProfile } from '../services/contracts';

/** Conversation-backed connections keep their note and bookmark in a local record keyed by the conversation id. */
function localRecord(connection: ConnectionView): ConnectionRecord {
  return { id: connection.id, personId: connection.personId, eventId: connection.eventId, connectedAt: connection.connectedAt, messages: [],
    note: connection.note, bookmarked: connection.bookmarked, origin: 'conversation', conversationId: connection.id };
}

/** Event context, shared interests and a private note. Rendered above the recap in the chat. */
export function ConnectionContext({ connection, me, onOpenPerson }: { connection: ConnectionView; me: PersonProfile; onOpenPerson: () => void }) {
  const { dispatch } = useAppStore();
  const [note, setNote] = useState(connection.note);
  const [saved, setSaved] = useState(false);
  const [noteFor, setNoteFor] = useState(connection.id);
  if (noteFor !== connection.id) { setNoteFor(connection.id); setNote(connection.note); setSaved(false); }
  useEffect(() => {
    if (note === connection.note) return;
    const timer = setTimeout(() => {
      if (connection.origin === 'conversation') dispatch({ type: 'connection', record: localRecord(connection) });
      dispatch({ type: 'connectionPatch', id: connection.id, patch: { note } });
      setSaved(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [note, connection, dispatch]);
  const shared = buildSuggestion(me, connection.person).shared;
  return <View style={{ gap: 12 }}>
    <View style={{ backgroundColor: colors.paper, borderRadius: radius.lg, padding: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="map-pin" size={15} color={colors.muted} />
        <Text style={[type.small, { flex: 1 }]}>{connection.event ? `Met at ${connection.event.title}, ${formatEventDate(connection.event.startsAt)}` : `Met ${relativeDay(connection.connectedAt)}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`About ${connection.person.name}`} onPress={onOpenPerson}><Text style={[type.smallStrong, { color: colors.ink }]}>Profile</Text></Pressable>
      </View>
      {shared.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Text style={type.small}>You both like</Text>{shared.map(i => <Chip key={i} selected>{i}</Chip>)}
      </View>}
    </View>
    <View style={{ backgroundColor: colors.powderLight, borderRadius: radius.lg, padding: 14, gap: 6 }}>
      <View style={s.between}>
        <Text style={type.label}>Private note</Text>
        <Text style={type.micro}>{saved && note === connection.note ? 'Saved' : 'Only you can see this'}</Text>
      </View>
      <TextInput value={note} onChangeText={setNote} multiline maxLength={500} accessibilityLabel="Private note" testID="connection-note"
        placeholder={`Something to remember about ${connection.person.name.split(' ')[0]}…`} placeholderTextColor={colors.faint}
        style={{ minHeight: 56, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink, padding: 0, textAlignVertical: 'top' }} />
    </View>
  </View>;
}

function sampleConversation(connection: ConnectionView, me: PersonProfile): Conversation {
  return {
    id: connection.id, eventId: connection.eventId, participants: [me, connection.person], recorderId: me.id, status: 'shared',
    recordingConsent: [me.id, connection.personId], exchangeConsent: [me.id, connection.personId], connectedAt: connection.connectedAt,
    endedAt: connection.connectedAt, consentMode: 'event', recap: connection.recap, messages: connection.messages, finishMethod: 'gesture',
  };
}

/** A remembered person: who, where, what you share, your note, the shared recap and the chat. */
export function ConnectionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance();
  const me = useMe();
  const demo = useDemoMode();
  const { dispatch } = useAppStore();
  const connection = useConnection(id);
  const [sheet, setSheet] = useState(false);
  if (!connection || !me) return <Page back title="Connection" fallback="/connections">
    <Empty icon="users" title="This connection isn’t available." text="It may have been deleted, or it belongs to a different account."
      action={<Button tone="secondary" onPress={() => router.replace('/connections')}>Back to connections</Button>} />
  </Page>;
  const suggestion = buildSuggestion(me, connection.person, { eventTitle: connection.event?.title, prompt: connection.event?.prompt });
  const conversation = connection.conversation ?? sampleConversation(connection, me);
  const onBack = () => router.canGoBack() ? router.back() : router.replace('/connections');
  return <View style={{ flex: 1 }}>
    <ConversationChat conversation={conversation} me={me} demo={demo} eventTitle={connection.event?.title} error={app.error}
      previewControls={connection.origin === 'conversation' ? <DemoActors participantIds={conversation.participants.map(p => p.id)} /> : demo ? <SampleTag>Sample connection</SampleTag> : undefined}
      context={<ConnectionContext connection={connection} me={me} onOpenPerson={() => setSheet(true)} />}
      onOpenPerson={() => setSheet(true)}
      onBack={onBack}
      onSend={async text => {
        if (connection.origin === 'conversation') { await app.run(() => app.sendMessage(connection.id, text)); return; }
        const value = text.trim();
        if (!value || value.length > 2000) throw new Error('Write a message between 1 and 2,000 characters.');
        dispatch({ type: 'connectionMessage', id: connection.id, message: { id: `message-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, conversationId: connection.id, senderId: me.id, text: value, createdAt: Date.now() } });
      }}
      onDelete={async () => {
        if (connection.origin === 'conversation') {
          if (app.mode === 'demo') app.demo({ type: 'delete', id: connection.id }); else await app.client!.deleteConversation(app.token, connection.id);
        } else dispatch({ type: 'connectionRemove', id: connection.id });
        router.replace('/connections');
      }} />
    <PersonSheet suggestion={suggestion} open={sheet} onClose={() => setSheet(false)} bookmarked={connection.bookmarked}
      onToggleBookmark={() => {
        if (connection.origin === 'conversation') dispatch({ type: 'connection', record: localRecord(connection) });
        dispatch({ type: 'connectionPatch', id: connection.id, patch: { bookmarked: !connection.bookmarked } });
      }}
      metBefore={connection.event ? `Connected at ${connection.event.title}` : undefined} />
  </View>;
}
