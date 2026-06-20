// SPDX-License-Identifier: Apache-2.0
// A worked example saved straight off the board: build it with the editor, press
// Save (downloads a .json), and paste the file's contents below as the value of
// `circuit`. No hand-translation into place()/wire() calls — `savedExample()` in
// examples.ts turns this into a playable example. To retune it, re-save and re-paste.

import type { SavedCircuit } from "../examples";

const circuit: SavedCircuit = {
  format: "cec-circuit",
  version: 1,
  savedAt: "2026-06-20T00:48:54.515Z",
  graph: {
    components: [
      { id: 1, kind: "V", cell: { col: 0, row: 0 }, value: 5, rot: 1 },
      {
        id: 2,
        kind: "POT",
        cell: { col: 3, row: -2 },
        value: 10000,
        rot: 0,
        wiper: 1,
        label: "Potentiometer",
      },
      {
        id: 3,
        kind: "R",
        cell: { col: 9, row: 1 },
        value: 330,
        rot: 0,
        label: "LED Resistor",
      },
      { id: 4, kind: "LED", cell: { col: 13, row: 1 }, value: 0, rot: 0 },
      { id: 5, kind: "GND", cell: { col: 7, row: 6 }, value: 0, rot: 0 },
    ],
    wires: [
      {
        id: 1,
        from: { componentId: 1, pinIndex: 0 },
        to: { componentId: 2, pinIndex: 0 },
        waypoints: [{ col: 0, row: -2 }],
      },
      {
        id: 2,
        from: { componentId: 2, pinIndex: 1 },
        to: { componentId: 5, pinIndex: 0 },
        waypoints: [{ col: 7, row: -2 }],
      },
      {
        id: 3,
        from: { componentId: 1, pinIndex: 1 },
        to: { componentId: 5, pinIndex: 0 },
        waypoints: [{ col: 0, row: 6 }],
      },
      {
        id: 4,
        from: { componentId: 2, pinIndex: 2 },
        to: { componentId: 3, pinIndex: 0 },
        waypoints: [{ col: 4, row: 1 }],
      },
      {
        id: 5,
        from: { componentId: 3, pinIndex: 1 },
        to: { componentId: 4, pinIndex: 0 },
      },
      {
        id: 6,
        from: { componentId: 4, pinIndex: 1 },
        to: { componentId: 5, pinIndex: 0 },
        waypoints: [
          { col: 17, row: 1 },
          { col: 17, row: 6 },
        ],
      },
    ],
    junctions: [],
    netLabels: [
      {
        id: 1,
        name: "V(p_out)",
        at: { componentId: 2, pinIndex: 2 },
        pos: { col: 6, row: 1 },
        tagOff: { dx: 17.285743300989708, dy: -61.69590676166275 },
      },
      {
        id: 2,
        name: "V(led)",
        at: { componentId: 3, pinIndex: 1 },
        pos: { col: 12, row: 1 },
        tagOff: { dx: 8.499031790305821, dy: -57.81051205080103 },
      },
      {
        id: 3,
        name: "V(p_in)",
        at: { componentId: 1, pinIndex: 0 },
        pos: { col: 1, row: -2 },
        tagOff: { dx: 21.657980983127544, dy: -65.72090621318786 },
      },
    ],
    nextComponentId: 6,
    nextWireId: 7,
    nextJunctionId: 1,
    nextNetLabelId: 4,
  },
};

export default circuit;
