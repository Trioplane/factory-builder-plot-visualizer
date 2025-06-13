import { BlockState, Identifier, Structure } from "deepslate";
import { mat4 } from "gl-matrix";

export class CombinedStructure {
  /**
   * 
   * @param {[number, number, number]} size 
   * @param {{structure: Structure, offset: [number, number, number]}[]} structureList 
   */
  constructor(size, structureList) {
    this.combinedStructure = new Structure(size);
    for (let structure of structureList) {
      const { structure: actualStructure, offset } = structure;
      const structureSize = actualStructure.getSize()
      const bounds = [...structureSize].map((v, i) => v >= offset[i] ? v : v + offset[i])

      for (let i = 0; i < bounds.length; i++) if (bounds[i] > size[i]) throw new RangeError("Structure is out of bounds.")

      for (let x = 0; x < structureSize[0]; x++) {
        for (let y = 0; y < structureSize[1]; y++) {
          for (let z = 0; z < structureSize[2]; z++) {
            const offsetedPos = [x + offset[0], y + offset[1], z + offset[2]];

            const block = actualStructure.getBlock([x, y, z])
            if (!block) {
              this.combinedStructure.addBlock(offsetedPos, "minecraft:air")
              continue;
            }
            const blockState = block.state
            this.combinedStructure.addBlock(offsetedPos, blockState.getName(), blockState.getProperties())
          }
        }
      }
    }
  }
}

// https://github.com/misode/deepslate/blob/main/demo/main.ts
export class InteractiveCanvas {
  #xRotation = 0.8
  #yRotation = 0.5

  constructor(
    canvas,
    onRender,
    center,
    viewDist = 4,
  ) {
    this.onRender = onRender;
    this.center = center;
    this.viewDist = viewDist;

    let dragPos = null;

    canvas.addEventListener('mousedown', evt => {
      if (evt.button === 0) {
        dragPos = [evt.clientX, evt.clientY]
      }
    })
    canvas.addEventListener('mousemove', evt => {
      if (dragPos) {
        this.#yRotation += (evt.clientX - dragPos[0]) / 100
        this.#xRotation += (evt.clientY - dragPos[1]) / 100
        this.#xRotation = Math.max(Math.PI / -2, Math.min(Math.PI / 2, this.#xRotation))
        dragPos = [evt.clientX, evt.clientY]
        this.redraw()
      }
    })
    canvas.addEventListener('mouseup', () => {
      dragPos = null
    })
    canvas.addEventListener('wheel', evt => {
      evt.preventDefault()
      this.viewDist += evt.deltaY / 100
      this.redraw()
    })
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.redraw()
    })
    
    this.redraw()
  }

  redraw() {
    requestAnimationFrame(() => this.#renderImmediately())
  }

  #renderImmediately() {
    this.#yRotation = this.#yRotation % (Math.PI * 2)
    this.xRotation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.#xRotation))
    this.viewDist = Math.max(1, this.viewDist)

    const view = mat4.create()
    mat4.translate(view, view, [0, 0, -this.viewDist])
    mat4.rotate(view, view, this.#xRotation, [1, 0, 0])
    mat4.rotate(view, view, this.#yRotation, [0, 1, 0])
    if (this.center) {
      mat4.translate(view, view, [-this.center[0], -this.center[1], -this.center[2]])
    }

    this.onRender(view)
  }
}

export function rawBlockSyntaxToBlockState(rawBlockSyntax, resources) {
  const [ rawId, propertiesString ] = rawBlockSyntax.split("[")
  const id = new Identifier("minecraft", rawId)
  const properties = {};

  // add default properties
  const blockDefinition = resources.getBlockDefinition(id)
    const rawProperties = Object.keys(blockDefinition.variants)[0]
    if (rawProperties) {
      const splitProperties = rawProperties.split(",")
      for (let property of splitProperties) {
        let [ key, value ] = property.split("=")
        properties[key] = value
    }
  }

  if (propertiesString) {
    const rawProperties = propertiesString.substring(0, propertiesString.length - 1).split(",");
    for (let rawProperty of rawProperties) {
      let [ key, value ] = rawProperty.split("=")
      properties[key] = value
    }
  }

  return new BlockState(id, properties)
}