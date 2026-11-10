import type { ComponentDefinition } from './types.js';

export function specification(component: ComponentDefinition, productId: string): string {
  const lines=[`# ${component.name}`,'',`Product: ${productId}`,`Catalog id: ${component.id}`,'',
    '## Overview','',component.description,'','## Anatomy','',...component.anatomy.map((entry)=>`- ${entry}`),'',
    '## Variants','',...(component.variants.length ? component.variants:['No variants specified.']).map((entry)=>`- ${entry}`),'',
    '## Props','',...component.props.map((prop)=>`- ${prop.name}: ${prop.type}; ${prop.required ? 'required':'optional'}${prop.default ? `; default: ${prop.default}`:''}. ${prop.description}`),'',
    '## States','',...component.states.map((entry)=>`- ${entry}`),'','## Behavior','',...component.behavior.map((entry)=>`- ${entry}`),'',
    '## Accessibility','',...component.accessibility.map((entry)=>`- ${entry}`),'','## Usage','',...component.usage.map((entry)=>`- ${entry}`),'',
    '## Avoid','',...component.antiUsage.map((entry)=>`- ${entry}`),'','## Implementation','',...component.implementation.map((entry)=>`- ${entry}`),'',
    '## Consumers','',...component.consumers.map((entry)=>`- ${entry}`),'',
    'Local UXQA checks do not replace the product component-library approval process.',''];
  return lines.join('\n');
}
