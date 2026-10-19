import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, Badge, Card, CardHeader, Caption1, CounterBadge, Text } from '@fluentui/react-components';
import type { BadgeProps } from '@fluentui/react-components';
import { DocumentText16Regular, Sparkle16Filled, Translate16Regular, PeopleTeam20Regular } from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import type { FeedItem, LiveEnd, LineSource } from '../../../src/types.ts';

const TYPE_LABEL: Record<string, string> = {
  goal: 'Goal',
  big_chance: 'Big chance',
  pressing_spell: 'Pressing',
  momentum_swing: 'Momentum',
  great_pass: 'Great pass',
  sprint: 'Speed',
  half_time: 'Half-time',
  full_time: 'Full-time',
  recap: 'Recap',
};

const SOURCE: Record<LineSource, { label: string; color: BadgeProps['color']; icon: ReactElement; hint: string }> = {
  model: { label: 'AI', color: 'success', icon: <Sparkle16Filled />, hint: 'Written by the AI for this audience and fact-checked' },
  insight: { label: 'AI · Tactician', color: 'success', icon: <Sparkle16Filled />, hint: "The Tactician's AI line, used when the Narrator could not deliver" },
  template: { label: 'Template', color: 'subtle', icon: <DocumentText16Regular />, hint: 'Deterministic fallback built only from the match data' },
  'template+translator': { label: 'Translated', color: 'informative', icon: <Translate16Regular />, hint: 'Fallback line translated by Azure AI Translator' },
  'insight+translator': { label: 'AI · Translated', color: 'informative', icon: <Translate16Regular />, hint: 'AI line translated by Azure AI Translator' },
};

interface Props {
  items: FeedItem[];
  status: string;
  summary: LiveEnd | null;
}

export default function Feed({ items, status, summary }: Props) {
  const newestFirst = [...items].reverse();
  return (
    <Card className="feed-panel" data-tour="feed">
      <CardHeader
        image={<PeopleTeam20Regular />}
        header={
          <Text weight="semibold">
            The story so far <CounterBadge count={items.length} size="small" appearance="ghost" />
          </Text>
        }
        description={
          <Caption1 className="muted">
            {status === 'ended' && summary ? `Full time · ${summary.items} items aired across both audiences` : 'Every line cites the events it is based on'}
          </Caption1>
        }
      />
      <ol className="feed" id="feed">
        {newestFirst.map((item) => {
          const src = SOURCE[item.source] ?? SOURCE.template;
          return (
            <li key={item.id}>
              <div className="meta">
                <Badge appearance="filled" color="brand" size="small">{item.clock}</Badge>
                <Caption1>{TYPE_LABEL[item.type] ?? item.type}</Caption1>
                <Badge appearance="tint" color={src.color} size="small" icon={src.icon} title={src.hint}>
                  {src.label}
                </Badge>
              </div>
              <Text as="p" block weight="semibold" className="head" dir="auto">
                {item.headline}
              </Text>
              <Text as="p" block className="text" dir="auto">
                {item.text}
              </Text>
              <Accordion collapsible className="evidence">
                <AccordionItem value="e">
                  <AccordionHeader size="small">
                    Evidence: {item.cites.length} event{item.cites.length === 1 ? '' : 's'}
                  </AccordionHeader>
                  <AccordionPanel>
                    <code>{item.cites.join(', ')}</code>
                    {item.tags && item.tags.length > 0 && <Caption1 block>Tags: {item.tags.join(', ')}</Caption1>}
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
