import React from 'react';
import { Text, View } from 'react-native';
import { Chip, Portrait } from '../components';
import { colors, radius, type } from '../theme';
import type { PersonProfile } from '../services/contracts';

/**
 * How a person appears to other attendees: portrait in an arch, name, what they
 * do, then the human parts. Used for the signup preview, the You screen and
 * person sheets so the preview is exactly what others see.
 */
export function PersonCard({ person, caption, footer, compact = false }: {
  person: PersonProfile; caption?: string; footer?: React.ReactNode; compact?: boolean;
}) {
  return <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: compact ? 18 : 22, gap: 14, alignItems: compact ? 'flex-start' : 'center' }}>
    <View style={{ flexDirection: compact ? 'row' : 'column', alignItems: 'center', gap: compact ? 14 : 12 }}>
      <Portrait person={person} size={compact ? 64 : 112} />
      <View style={{ gap: 2, alignItems: compact ? 'flex-start' : 'center', flexShrink: 1 }}>
        <Text style={[type.heading, !compact && { textAlign: 'center', fontSize: 26, lineHeight: 30 }]}>{person.name || 'Your name'}</Text>
        <Text style={[type.secondary, !compact && { textAlign: 'center' }]}>{person.occupation || person.role || 'What you do'}</Text>
        {caption && <Text style={[type.small, { marginTop: 4 }]}>{caption}</Text>}
      </View>
    </View>
    {person.interests.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: compact ? 'flex-start' : 'center' }}>
      {person.interests.map(interest => <Chip key={interest}>{interest}</Chip>)}
    </View>}
    {person.facts.length > 0 && <View style={{ gap: 6, alignSelf: 'stretch' }}>
      {person.facts.map(fact => <Text key={fact} style={[type.quote, { textAlign: compact ? 'left' : 'center' }]}>{fact}</Text>)}
    </View>}
    {footer}
  </View>;
}
