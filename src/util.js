import { BlockState, Identifier, Structure, BlockDefinition, BlockModel, TextureAtlas } from "deepslate";
import { mat4, vec3 } from "gl-matrix";
import jszip from 'jszip'

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
              this.combinedStructure.addBlock(offsetedPos, "minecraft:air", {})
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
  #xRotation = 20 * Math.PI / 180
  #yRotation = 45 * Math.PI / 180

  constructor(
    canvas,
    onRender,
    structureCenter
  ) {
    this.onRender = onRender;
    this.structureCenter = structureCenter;
    this.center = [0, 0, 20];

    let dragPos = null;
    let panPos = null;

    canvas.addEventListener('mousedown', evt => {
      if (evt.button === 2) {
        dragPos = [evt.clientX, evt.clientY]
      }
      if(evt.button === 1) {
        panPos = [evt.clientX, evt.clientY]
      }
    })
    canvas.addEventListener('mousemove', evt => {
      if (dragPos) {
        this.#yRotation += (evt.clientX - dragPos[0]) / 250
        this.#xRotation += (evt.clientY - dragPos[1]) / 250
        this.#xRotation = Math.max(Math.PI / -2, Math.min(Math.PI / 2, this.#xRotation))
        dragPos = [evt.clientX, evt.clientY]
        this.redraw()
      }
      if(panPos) {
        /*// generate UP vector for camera
        var zero = vec3.fromValues(0, 0, 0)
        var UP = vec3.fromValues(0, 1, 0)
        vec3.rotateY(UP, UP, zero, -this.#yRotation)
        vec3.rotateX(UP, UP, zero, -this.#xRotation)
        vec3.scale(UP, UP, (evt.clientY - panPos[1]) / 250)
        // move camera according to mouse dY and UP vector
        this.center = [this.center[0] + UP[0], this.center[1] + UP[1], this.center[2] + UP[2]]
        
        // generate RIGHT vector for camera
        var RIGHT = vec3.fromValues(1, 0, 0)
        vec3.rotateY(RIGHT, RIGHT, zero, -this.#yRotation)
        vec3.rotateX(RIGHT, RIGHT, zero, -this.#xRotation)
        vec3.scale(RIGHT, RIGHT, (evt.clientX - panPos[0]) / 250)
        // move camera according to mouse dY and UP vector
        this.center = [this.center[0] + RIGHT[0], this.center[1] + RIGHT[1], this.center[2] + RIGHT[2]]*/
        this.center[0] -= (evt.clientX - panPos[0]) / 50
        this.center[1] += (evt.clientY - panPos[1]) / 50
        panPos = [evt.clientX, evt.clientY]
        this.redraw()
      }
    })
    canvas.addEventListener('mouseup', () => {
      dragPos = null
      panPos = null
    })
    canvas.addEventListener('wheel', evt => {
      evt.preventDefault()
      this.center[2] += evt.deltaY / 100
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
    const view = mat4.create()
    mat4.translate(view, view, [-this.center[0], -this.center[1], -this.center[2]])
    mat4.rotate(view, view, this.#xRotation, [1, 0, 0])
    mat4.rotate(view, view, this.#yRotation, [0, 1, 0])
    mat4.translate(view, view, [-this.structureCenter[0], -this.structureCenter[1], -this.structureCenter[2]])

    this.onRender(view)
  }
}

// https://github.com/jacobsjo/minecraft-jigsaw-preview/blob/main/src/ResourceManger/ZipResourceManager.ts
// modified a bit and patched bugs very not well but it works, removed typescript syntax
export class ZipResourceManager {
  constructor(blockDefinitions, blockModels, namespace) {
    this.blockDefinitions = blockDefinitions
    this.blockModels = blockModels
    this.blockAtlas = TextureAtlas.empty()
    this.namespace = namespace
  }

  getTextureAtlas() {
    return this.blockAtlas.getTextureAtlas()
  }

  getBlockProperties(id) {
    return null
  }

  getDefaultBlockProperties(id) {
    return null;
  }

  getBlockDefinition(id) {
    return this.blockDefinitions[id.toString()]
  }

  getBlockModel(id) {
    return this.blockModels[id.toString()]
  }

  getTextureUV(id) {
    return this.blockAtlas.getTextureUV(id)
  }

  getBlockAtlas() {
    return this.blockAtlas
  }

  getBlockFlags(id) {
    return {
      opaque: false
    }
  }

  async loadFromZip(url, vanillaTexturesUrl) {
    const assetsBuffer = await (await fetch(url)).arrayBuffer()
    const assets = await jszip.loadAsync(assetsBuffer)
    await this.loadFromFolderJson(assets.folder('minecraft/blockstates'), `assets/minecraft/blockstates`, async (id, data) => {
      id = 'minecraft:' + id
      this.blockDefinitions[id] = BlockDefinition.fromJson(data)
    })
    await this.loadFromFolderJson(assets.folder(`assets/${this.namespace}/models/block`), `assets/${this.namespace}/models/block`, async (id, data) => {
      id = `${this.namespace}:block/` + id
      this.blockModels[id] = BlockModel.fromJson(data)
    })
    const textures = {}
    await this.loadFromFolderPng(assets.folder(`assets/${this.namespace}/textures/block`), `assets/${this.namespace}/textures/block`, async (id, data) => {
      textures[`${this.namespace}:block/` + id] = data
    })

    const vanillaTexturesBuffer = await (await fetch(vanillaTexturesUrl)).arrayBuffer()
    const vanilllaTextures = await jszip.loadAsync(vanillaTexturesBuffer)
    await this.loadFromFolderPng(vanilllaTextures.folder(), ``, async (id, data) => {
      textures[`minecraft:block/` + id] = data
    })

    this.blockAtlas = await TextureAtlas.fromBlobs(textures)
    Object.values(this.blockModels).forEach(m => m.flatten(this))
  }

  loadFromFolderJson(folder, folderPath, callback) {
    const promises = []
    for (let [path, file] of Object.entries(folder.files)) {
      if (file.dir || !path.endsWith('.json') || !path.startsWith(folderPath)) continue
      const id = path.replace(/\.json$/, '').replace(`${folderPath}/`, '')
      promises.push(file.async('text').then(data => callback(id, JSON.parse(data))))
    }
    return Promise.all(promises)
  }

  loadFromFolderPng(folder, folderPath, callback) {
    const promises = []
    for (let [path, file] of Object.entries(folder.files)) {
      if (file.dir || !path.endsWith('.png') || !path.startsWith(folderPath)) continue
      const id = path.replace(/\.png$/, '').replace(`${folderPath}/`, '')
      promises.push(file.async('blob').then(data => callback(id, data)))
    }
    return Promise.all(promises)
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