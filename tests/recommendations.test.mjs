import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('../src/piv-acquisition-feasibility-calculator.html', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'calculator script was not found');

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.textContent = '';
    this.value = '0';
    this.checked = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  dispatch(type) {
    this.listeners[type]?.();
  }

  get firstChild() {
    return this.children[0] || null;
  }
}

const elements = new Map();
const classes = new Map();
const inputIds = [];
for (const match of source.matchAll(/<([a-z]+)([^>]*?)\bid="([^"]+)"([^>]*)>/gi)) {
  const [, tag, beforeId, id, afterId] = match;
  const attributes = `${beforeId} ${afterId}`;
  const element = new MockElement(id);
  const value = attributes.match(/\bvalue="([^"]*)"/i)?.[1];
  const className = attributes.match(/\bclass="([^"]*)"/i)?.[1] || '';
  if (value !== undefined) element.value = value;
  if (/\bchecked\b/i.test(attributes)) element.checked = true;
  elements.set(id, element);
  className.split(/\s+/).filter(Boolean).forEach(name => classes.set(name, element));
  if (tag.toLowerCase() === 'input') inputIds.push(id);
}

const root = elements.get('piv-retention-tool');
assert.ok(root, 'calculator root was not found');
classes.set('prt-chart', new MockElement('prt-chart'));
classes.set('prt-sampling-chart', new MockElement('prt-sampling-chart'));
root.querySelector = selector => selector.startsWith('#') ? elements.get(selector.slice(1)) : classes.get(selector.slice(1));
root.querySelectorAll = selector => selector === 'input' ? inputIds.map(id => elements.get(id)) : [];

const documentMock = {
  getElementById: id => elements.get(id),
  createElementNS: () => new MockElement(),
  createElement: () => new MockElement()
};

new Function('document', script)(documentMock);

const textTree = element => `${element.textContent}${element.children.map(textTree).join('')}`;
const recommendationText = () => textTree(elements.get('prt-recommendations'));
const update = () => elements.get('prt-rate').dispatch('input');

assert.match(recommendationText(), /Use a larger predictor pass with window deformation/);
assert.match(recommendationText(), /Do not interpret the desired scale as time resolved/);
assert.equal(elements.get('prt-recommendation-mode').textContent, 'Fixed laser timing');

elements.get('prt-laser-fixed').checked = false;
update();
assert.match(recommendationText(), /Shorten the pulse-pair separation/);
assert.match(recommendationText(), /Increase the velocity-field acquisition rate/);
assert.equal(elements.get('prt-recommendation-mode').textContent, 'Acquisition adjustable');

elements.get('prt-laser-fixed').checked = true;
elements.get('prt-dt').value = '100';
elements.get('prt-wrms').value = '50';
update();
assert.match(recommendationText(), /Out-of-plane particle loss cannot be recovered by processing/);

elements.get('prt-dt').value = '1';
elements.get('prt-wrms').value = '2';
elements.get('prt-structure').value = '1';
update();
assert.match(recommendationText(), /desired structure is below the current optical sampling limit/);

console.log('Recommendation scenarios passed.');
