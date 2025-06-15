
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
const loadingMessage = document.getElementById("loading-message")
const enableGroundGhceckbox = document.getElementById("enable-ground")

async function init() {
  loadingMessage.textContent = `Fetching ${MCMETA} for vanilla assets...`
  const [blockstates, models] = await Promise.all([
  	fetch(`${MCMETA}summary/assets/block_definition/data.min.json`).then(r => r.json()),
  	fetch(`${MCMETA}summary/assets/model/data.min.json`).then(r => r.json()),
  ])

  // === Prepare assets for  structure rendering ===
  loadingMessage.textContent = `Preparing block definitions...`
	const blockDefinitions = {}
	Object.keys(blockstates).forEach(id => {
    blockDefinitions['minecraft:' + id] = BlockDefinition.fromJson(blockstates[id])
	})
  
  loadingMessage.textContent = `Preparing block models...`
	const blockModels = {}
	Object.keys(models).forEach(id => {
    blockModels['minecraft:' + id] = BlockModel.fromJson(models[id])
	})
	Object.values(blockModels).forEach((model) => model.flatten({ getBlockModel: id => blockModels[id] }))
  
  loadingMessage.textContent = `Preparing resource pack assets...`
  const zipResourceManager = new ZipResourceManager(blockDefinitions, blockModels, 'fb')
  await zipResourceManager.loadFromZip(new URL('./resource_pack.zip', import.meta.url).href, new URL('./blocks.zip', import.meta.url).href)
	// === Structure rendering ===
  
  loadingMessage.textContent = `Getting block map...`
  const BLOCK_MAP = Object.fromEntries(
    Object.entries(rawBlockMap).map(([key, value]) => [key, value.map(v => rawBlockSyntaxToBlockState(v, zipResourceManager))])
  );
  
  // Building floor
  loadingMessage.textContent = `Building floor...`
  const floorStructure = new Structure(FLOOR_SIZE)
  const floorStructureSize = floorStructure.getSize()

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
  loadingMessage.textContent = `Building plot...`
  let plotData = [];
  let currentLayer = {
    direction: "y",
    slice: null,
    max: FACTORY_SIZE[1]
  };
  const plotStructure = buildPlot(BLOCK_MAP, plotData, floorStructure, currentLayer);
  const size = plotStructure.getSize();

  // Rendering
  loadingMessage.textContent = `Initializing canvas...`
	const structureCanvas = document.getElementById('mainCanvas')
  structureCanvas.width = window.innerWidth;
  structureCanvas.height = window.innerHeight;
	const structureGl = structureCanvas.getContext('webgl')
  loadingMessage.textContent = `Making structure renderer...`
  const structureRenderer = new StructureRenderer(structureGl, plotStructure, zipResourceManager)
  
  loadingMessage.textContent = `Rendering...`
  const interactiveCanvas = new InteractiveCanvas(structureCanvas, view => {
    structureRenderer.drawStructure(view)
	}, [size[0] / 2, size[1] / 2, size[2] / 2])
  
  loadingMessage.textContent = `Registering event listeners`
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

  enableGroundGhceckbox.addEventListener('change', () => {
    redrawPlot(BLOCK_MAP, plotData, floorStructure, currentLayer, structureRenderer, interactiveCanvas)
  })

  loadingMessage.style = 'display: none;'

  // disable context menu
  if (document.addEventListener) {
    document.addEventListener('contextmenu', function(e) {
      e.preventDefault();
    }, false);
  } else {
    document.attachEvent('oncontextmenu', function() {
      window.event.returnValue = false;
    });
  }
}

function buildPlot(blockMap, plotData, floorStructure, layer) {
  const factoryStructure = new Structure(FACTORY_SIZE);

  for (let entry of plotData) {
    if (layer.slice !== null && entry[layer.direction] !== layer.slice) continue
    const blockToUse = blockMap[entry.id][entry.direction % blockMap[entry.id].length]
    factoryStructure.addBlock([entry.x, entry.y, entry.z], blockToUse.getName(), blockToUse.getProperties())
  }

  const FULL_PLOT_SIZE = [...FLOOR_SIZE].map((v, i) => v >= FACTORY_SIZE[i] ? v : v + FACTORY_SIZE[i]);
  var structures = [{ structure: factoryStructure, offset: [0, 0, 0] }];
  if (enableGroundGhceckbox.checked || factoryStructure.getBlocks().length == 0)
    structures.push({ structure: floorStructure, offset: [0, 0, 0] });
  const structure = new CombinedStructure(FULL_PLOT_SIZE, structures).combinedStructure;
  return structure
}

function redrawPlot(blockMap, plotData, floorStructure, layer, structureRenderer, interactiveCanvas) {
  const plotStructure = buildPlot(blockMap, plotData, floorStructure, layer);
  structureRenderer.setStructure(plotStructure)
  interactiveCanvas.redraw()
}

init()