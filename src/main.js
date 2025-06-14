
import { BlockDefinition, BlockModel, Identifier, Structure, StructureRenderer, TextureAtlas, upperPowerOfTwo } from 'deepslate';
import { CombinedStructure, InteractiveCanvas, rawBlockSyntaxToBlockState, ZipResourceManager } from "./util.js";
import mojangson from 'mojangson'
import rawBlockMap from "./blockMap.json" with { type: "json" }

// https://github.com/misode/deepslate/blob/main/demo/main.ts
// Removed typescript syntax and item references

const MCMETA = 'https://raw.githubusercontent.com/misode/mcmeta/'

const FLOOR_SIZE = [16,1,16]
const FACTORY_SIZE = [14,6,14]

const plotDataInput = document.getElementById("plot-data-input")
const layerUpButton = document.getElementById("layer-up-button")
const layerDownButton = document.getElementById("layer-down-button")
const changeAxisButton = document.getElementById("change-axis-button")

async function init() {
  const [blockstates, models, uvMap, atlas] = await Promise.all([
  	fetch(`${MCMETA}summary/assets/block_definition/data.min.json`).then(r => r.json()),
  	fetch(`${MCMETA}summary/assets/model/data.min.json`).then(r => r.json()),
  	fetch(`${MCMETA}atlas/all/data.min.json`).then(r => r.json()),
  	new Promise(res => {
  		const image = new Image()
  		image.onload = () => res(image)
  		image.crossOrigin = 'Anonymous'
  		image.src = `${MCMETA}atlas/all/atlas.png`
  	}),
  ])

  // === Prepare assets for item and structure rendering ===
	const blockDefinitions = {}
	Object.keys(blockstates).forEach(id => {
		blockDefinitions['minecraft:' + id] = BlockDefinition.fromJson(blockstates[id])
	})

	const blockModels = {}
	Object.keys(models).forEach(id => {
		blockModels['minecraft:' + id] = BlockModel.fromJson(models[id])
	})
	Object.values(blockModels).forEach((model) => model.flatten({ getBlockModel: id => blockModels[id] }))

	const atlasCanvas = document.createElement('canvas')
	const atlasSize = upperPowerOfTwo(Math.max(atlas.width, atlas.height))
	atlasCanvas.width = atlasSize
	atlasCanvas.height = atlasSize
	const atlasCtx = atlasCanvas.getContext('2d')
	atlasCtx.drawImage(atlas, 0, 0)
	const atlasData = atlasCtx.getImageData(0, 0, atlasSize, atlasSize)
	const idMap = {}
	Object.keys(uvMap).forEach(id => {
		const [u, v, du, dv] = uvMap[id]
		const dv2 = (du !== dv && id.startsWith('block/')) ? du : dv
		idMap[Identifier.create(id).toString()] = [u / atlasSize, v / atlasSize, (u + du) / atlasSize, (v + dv2) / atlasSize]
	})
	const textureAtlas = new TextureAtlas(atlasData, idMap)

	const vanillaResources = {
		getBlockDefinition(id) { return blockDefinitions[id.toString()] },
		getBlockModel(id) { return blockModels[id.toString()] },
		getTextureUV(id) { return textureAtlas.getTextureUV(id) },
		getTextureAtlas() { return textureAtlas.getTextureAtlas() },
		getBlockFlags(id) { return { opaque: false } },
		getBlockProperties(id) { return null },
		getDefaultBlockProperties(id) { return null },
	}

  const zipResourceManager = new ZipResourceManager(blockDefinitions, blockModels, textureAtlas, 'fb')
  await zipResourceManager.loadFromZip(new URL('./resource_pack.zip', import.meta.url).href, new URL('./blocks.zip', import.meta.url).href)
	// === Structure rendering ===

  const BLOCK_MAP = Object.fromEntries(
    Object.entries(rawBlockMap).map(([key, value]) => [key, value.map(v => rawBlockSyntaxToBlockState(v, zipResourceManager))])
  );

  const floorStructure = new Structure(FLOOR_SIZE)
  const floorStructureSize = floorStructure.getSize()

  // Building floor
  for (let x = 0; x < floorStructureSize[0]; x++) {
    for (let z = 0; z < floorStructureSize[2]; z++) {
      const outerEdge = { min: 0, max: floorStructureSize[0] - 1 }
      const innerEdge = { min: 1, max: floorStructureSize[0] - 2 }
      if (
        x === outerEdge.min || x === outerEdge.max ||
        z === outerEdge.min || z === outerEdge.max
      ) {
        floorStructure.addBlock([x, 0, z], "minecraft:grass_block", { snowy: 'false' })
        continue;
      } else if (
        x === innerEdge.min || x === innerEdge.max ||
        z === innerEdge.min || z === innerEdge.max
      ) {
        floorStructure.addBlock([x, 0, z], "minecraft:polished_andesite")
        continue;
      }

      floorStructure.addBlock([x, 0, z], "minecraft:stone")
    }
  }

  // Building the whole plot
  let plotData = [];
  let currentLayer = {
    direction: "y",
    slice: null,
    max: FACTORY_SIZE[1]
  };
  const plotStructure = buildPlot(BLOCK_MAP, plotData, floorStructure, currentLayer);
  const size = plotStructure.getSize();

  // Rendering
	const structureCanvas = document.getElementById('mainCanvas')
  structureCanvas.width = window.innerWidth;
  structureCanvas.height = window.innerHeight;
	const structureGl = structureCanvas.getContext('webgl')
  const structureRenderer = new StructureRenderer(structureGl, plotStructure, zipResourceManager)

  const interactiveCanvas = new InteractiveCanvas(structureCanvas, view => {
		structureRenderer.drawStructure(view)
	}, [size[0] / 2, size[1] / 2, size[2] / 2])

  plotDataInput.addEventListener('input', () => {
    try {
      plotData = mojangson.simplify(mojangson.parse(plotDataInput.value))
      redrawPlot(BLOCK_MAP, plotData, floorStructure, currentLayer, structureRenderer, interactiveCanvas)
    } catch (err) {
      console.log(err)
      console.warn("Invalid syntax.")
    }
  })

  layerUpButton.addEventListener('click', () => {
    currentLayer.slice = currentLayer.slice === null ? 1 : currentLayer.slice + 1;
    currentLayer.slice = currentLayer.slice >= currentLayer.max ? null : currentLayer.slice;
    redrawPlot(BLOCK_MAP, plotData, floorStructure, currentLayer, structureRenderer, interactiveCanvas)
  })

  layerDownButton.addEventListener('click', () => {
    currentLayer.slice = currentLayer.slice === null ? 5 : currentLayer.slice - 1;
    currentLayer.slice = currentLayer.slice < 1 ? null : currentLayer.slice
    redrawPlot(BLOCK_MAP, plotData, floorStructure, currentLayer, structureRenderer, interactiveCanvas)
  })

  const axes = ['x', 'y', 'z']
  changeAxisButton.addEventListener('click', () => {
    currentLayer.direction = axes[(axes.indexOf(currentLayer.direction) + 1) % 3]
    currentLayer.max = FACTORY_SIZE[axes.indexOf(currentLayer.direction)]
    currentLayer.slice = currentLayer.direction === 'y' ? 1 : 2
    changeAxisButton.textContent = currentLayer.direction.toUpperCase()
    redrawPlot(BLOCK_MAP, plotData, floorStructure, currentLayer, structureRenderer, interactiveCanvas)
  })
}

function buildPlot(blockMap, plotData, floorStructure, layer) {
  const factoryStructure = new Structure(FACTORY_SIZE);

  for (let entry of plotData) {
    if (layer.slice !== null && entry[layer.direction] !== layer.slice) continue
    const blockToUse = blockMap[entry.id][entry.direction % blockMap[entry.id].length]
    factoryStructure.addBlock([entry.x, entry.y, entry.z], blockToUse.getName(), blockToUse.getProperties())
  }

  const FULL_PLOT_SIZE = [...FLOOR_SIZE].map((v, i) => v >= FACTORY_SIZE[i] ? v : v + FACTORY_SIZE[i]);
  const structure = new CombinedStructure(FULL_PLOT_SIZE, [
        {
          structure: floorStructure,
          offset: [0, 0, 0]
        }, {
          structure: factoryStructure,
          offset: [0, 0, 0]
        }
      ]).combinedStructure;
  return structure
}

function redrawPlot(blockMap, plotData, floorStructure, layer, structureRenderer, interactiveCanvas) {
  const plotStructure = buildPlot(blockMap, plotData, floorStructure, layer);
  structureRenderer.setStructure(plotStructure)
  interactiveCanvas.redraw()
}

init()