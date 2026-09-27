/* ==========================================================================
   Future Food Production — course registry
   Single source of truth for modules, lessons, laboratories and outcomes.
   Loaded as a classic script (before site.js) and exposed as window.FFP_COURSE.
   ========================================================================== */
(function () {
  const outcomes = [
    { id: 'LO1', short: 'Technologies & planetary boundaries',
      text: 'Describe and compare emerging and novel technologies in food production and relate their possibilities and limitations to the planetary boundaries.' },
    { id: 'LO2', short: 'CEA principles',
      text: 'Explain the structure and operation of controlled environment agriculture systems, such as hydroponics, aquaponics and aeroponics, based on the underlying principles of biology, chemistry and physics.' },
    { id: 'LO3', short: 'System calculations',
      text: 'Perform basic calculations on cultivation systems, for example mass, energy, water and light balances and key indicators of resource-use efficiency.' },
    { id: 'LO4', short: 'Experiments & statistics',
      text: 'Plan, conduct and document laboratory experiments on soilless cultivation, and analyse and report the results using basic statistical methods.' },
    { id: 'LO5', short: 'AI, sensors & data',
      text: 'Explain how artificial intelligence, sensors and data-driven methods are used to monitor, predict and optimise food production, and apply simple models to their own production data.' },
    { id: 'LO6', short: 'Society & regulation',
      text: 'Analyse the societal, cultural and regulatory factors that enable or hinder the adoption of new food technologies, including the EU novel food framework.' },
    { id: 'LO7', short: 'Sustainability & resilience',
      text: 'Assess the accessibility, sustainability and resilience of emerging food production systems.' }
  ];

  const modules = [
    {
      n: 1, slug: 'foundations', color: '#3f9d6a', icon: 'globe',
      title: 'Food systems within planetary boundaries',
      tagline: 'Why the way we produce food must change — and how we measure it.',
      los: ['LO1', 'LO7'],
      lessons: [
        { slug: 'food-system-challenge', title: 'Feeding ten billion: the food-system challenge', minutes: 45,
          summary: 'Population, diets, yield gaps, food loss and waste: the demand and supply sides of the global food equation, and why technology alone cannot close it.' },
        { slug: 'planetary-boundaries', title: 'Planetary boundaries and the food system', minutes: 50,
          summary: 'The nine planetary boundaries, how agriculture drives at least six of them, the safe operating space and the EAT–Lancet planetary health diet.' },
        { slug: 'life-cycle-thinking', title: 'Life-cycle thinking: measuring the footprint of food', minutes: 55,
          summary: 'Functional units, system boundaries and allocation; greenhouse-gas, land, water and nutrient footprints; why per-kilogram and per-protein comparisons diverge.' },
        { slug: 'technology-landscape', title: 'Mapping the landscape of emerging food technologies', minutes: 50,
          summary: 'A structured tour of controlled environment agriculture, precision agriculture, gene editing, alternative proteins and digital agriculture — with readiness levels, hype cycles and system effects.' }
      ],
      labs: ['planetary-boundaries-dashboard', 'diet-footprint', 'earth-food-globe']
    },
    {
      n: 2, slug: 'plant-biology', color: '#5fae3d', icon: 'leaf',
      title: 'Plant physiology for controlled environments',
      tagline: 'The biology every grower must master: light, water, nutrients and growth.',
      los: ['LO2', 'LO3'],
      lessons: [
        { slug: 'photosynthesis', title: 'Photosynthesis: from photons to sugars', minutes: 60,
          summary: 'Light reactions, the Calvin–Benson cycle, C3/C4/CAM pathways, quantum yield, light- and CO₂-response curves and the Farquhar–von Caemmerer–Berry model.' },
        { slug: 'water-relations', title: 'Water relations, transpiration and vapour pressure deficit', minutes: 55,
          summary: 'Water potential, the soil–plant–atmosphere continuum, stomatal regulation, vapour pressure deficit and the Penman–Monteith equation.' },
        { slug: 'mineral-nutrition', title: 'Mineral nutrition and nutrient uptake', minutes: 55,
          summary: 'The essential elements, their functions and deficiency symptoms, membrane transport and Michaelis–Menten uptake kinetics, and the laws of the minimum.' },
        { slug: 'growth-analysis', title: 'Plant growth analysis and crop models', minutes: 55,
          summary: 'Relative growth rate, leaf area index, light interception (Beer–Lambert), radiation-use efficiency, harvest index and simple mechanistic crop models.' }
      ],
      labs: ['leaf-photosynthesis', 'stomata-transpiration', 'nutrient-uptake-root', 'crop-growth-model']
    },
    {
      n: 3, slug: 'experimental-methods', color: '#8a7a4a', icon: 'flask',
      title: 'Experimental design, statistics and reporting',
      tagline: 'The scientific toolkit for your own growing experiment.',
      los: ['LO4', 'LO5'],
      lessons: [
        { slug: 'experimental-design', title: 'Designing plant-growth experiments', minutes: 55,
          summary: 'Hypotheses, treatments and controls; replication, randomisation and blocking; pseudo-replication, confounding and statistical power.' },
        { slug: 'descriptive-statistics', title: 'Describing and visualising data', minutes: 45,
          summary: 'Measures of location and spread, distributions, error bars, standard error versus standard deviation, and honest graphical practice.' },
        { slug: 'inferential-statistics', title: 'Inferential statistics: t-tests, ANOVA and regression', minutes: 65,
          summary: 'Sampling distributions, confidence intervals, hypothesis tests, one-way ANOVA with post-hoc comparisons, linear regression and assumption checking.' },
        { slug: 'scientific-reporting', title: 'Writing the laboratory report', minutes: 40,
          summary: 'The IMRaD structure, figures and tables that communicate, reporting statistics correctly, referencing and research integrity.' }
      ],
      labs: ['experiment-designer', 'statistics-workbench', 'sampling-distributions']
    },
    {
      n: 4, slug: 'light', color: '#c0569b', icon: 'sun',
      title: 'Light: physics, measurement and engineering',
      tagline: 'Photons are the currency of plant growth — learn to count, place and pay for them.',
      los: ['LO2', 'LO3'],
      lessons: [
        { slug: 'radiation-physics', title: 'Radiation physics: photons, PAR and PPFD', minutes: 60,
          summary: 'Electromagnetic radiation, photon energy, radiometric versus quantum units, photosynthetically active radiation and the conversion from watts to micromoles.' },
        { slug: 'daily-light-integral', title: 'Daily light integral, photoperiod and the solar resource', minutes: 50,
          summary: 'Daily light integral, crop light requirements, solar geometry, seasonal light at high latitudes and supplementary lighting strategies.' },
        { slug: 'led-lighting-design', title: 'LED technology and lighting design', minutes: 60,
          summary: 'Semiconductor physics of LEDs, photon efficacy, thermal management, the inverse-square and cosine laws, uniformity and fixture layout.' },
        { slug: 'spectral-quality', title: 'Spectral quality and photomorphogenesis', minutes: 50,
          summary: 'Photoreceptors (phytochromes, cryptochromes, phototropins), red:far-red ratio, blue light, the McCree action spectrum and spectral recipes.' }
      ],
      labs: ['grow-room-lighting', 'spectrum-mixer', 'sun-and-dli']
    },
    {
      n: 5, slug: 'hydroponics', color: '#2f8fb8', icon: 'droplet',
      title: 'Hydroponics: soilless cultivation systems',
      tagline: 'Replacing soil with chemistry, hydraulics and control.',
      los: ['LO2', 'LO3', 'LO4'],
      lessons: [
        { slug: 'soilless-systems', title: 'Soilless systems and growing media', minutes: 50,
          summary: 'NFT, deep-water culture, ebb-and-flow, drip, wick and Kratky systems; substrates such as rock wool, coir and perlite; open versus recirculating operation.' },
        { slug: 'nutrient-solution-chemistry', title: 'Nutrient-solution chemistry: EC, pH and ion balance', minutes: 65,
          summary: 'Concentration units, electrical conductivity, pH and buffering, ion balance, chelates, precipitation and the calculation of a complete nutrient recipe.' },
        { slug: 'root-zone', title: 'The root zone: oxygen, temperature and microbiology', minutes: 50,
          summary: 'Dissolved oxygen and Henry’s law, root respiration, temperature effects, root diseases such as Pythium, and beneficial microbiomes.' },
        { slug: 'hydraulic-design', title: 'Hydraulic design and water management', minutes: 55,
          summary: 'Flow rates, NFT channel slope and film depth, pump curves and head losses, drain-to-waste versus recirculation, and water-use efficiency.' }
      ],
      labs: ['soilless-systems-3d', 'nft-system', 'deep-water-culture', 'nutrient-mixer', 'ph-availability']
    },
    {
      n: 6, slug: 'aquaponics', color: '#1f9e9a', icon: 'fish',
      title: 'Aquaponics: coupled fish–plant ecosystems',
      tagline: 'Fish, bacteria and plants as one engineered ecosystem.',
      los: ['LO2', 'LO3', 'LO7'],
      lessons: [
        { slug: 'aquaponic-ecosystem', title: 'The aquaponic ecosystem and the nitrogen cycle', minutes: 55,
          summary: 'Fish metabolism, ammonia excretion, nitrification by Nitrosomonas and Nitrobacter (and comammox), stoichiometry and alkalinity consumption.' },
        { slug: 'aquaponic-design', title: 'Designing and balancing aquaponic systems', minutes: 60,
          summary: 'Feed-rate ratio, biofilter sizing, coupled versus decoupled designs, nitrogen and phosphorus mass balances and nutrient supplementation.' },
        { slug: 'fish-water-quality', title: 'Water quality, fish welfare and system health', minutes: 50,
          summary: 'Un-ionised ammonia toxicity, nitrite, dissolved oxygen and CO₂, pH–alkalinity trade-offs, fish welfare indicators and food safety.' }
      ],
      labs: ['aquaponics-system', 'ammonia-toxicity', 'nutrient-mass-balance']
    },
    {
      n: 7, slug: 'aeroponics-vertical', color: '#7a63c9', icon: 'layers',
      title: 'Aeroponics, vertical farms and closed ecosystems',
      tagline: 'Stacking, misting and closing the loop — from city farms to Mars.',
      los: ['LO1', 'LO2', 'LO3', 'LO7'],
      lessons: [
        { slug: 'aeroponics', title: 'Aeroponics: roots in air', minutes: 45,
          summary: 'High- and low-pressure aeroponics, droplet physics, misting cycles, root-zone humidity and oxygen, and failure modes.' },
        { slug: 'vertical-farming', title: 'Vertical farms and plant factories with artificial lighting', minutes: 60,
          summary: 'Architecture of plant factories, space-use efficiency, energy and cost structures, lessons from business failures and where vertical farming makes sense.' },
        { slug: 'space-farming', title: 'Farming in space and extreme environments', minutes: 45,
          summary: 'Bioregenerative life-support systems, NASA Veggie, ESA MELiSSA, EDEN ISS in Antarctica, and what closed loops teach us about Earth.' }
      ],
      labs: ['aeroponic-chamber', 'vertical-farm-explorer', 'life-support-loop']
    },
    {
      n: 8, slug: 'climate-resources', color: '#d0763b', icon: 'thermo',
      title: 'Climate engineering: energy, water and carbon balances',
      tagline: 'Every kilogram of lettuce is an energy, water and carbon balance.',
      los: ['LO2', 'LO3', 'LO7'],
      lessons: [
        { slug: 'energy-balance', title: 'Energy balances of greenhouses and plant factories', minutes: 65,
          summary: 'Radiation, conduction, convection and latent heat; the steady-state energy balance; heat pumps and COP; where the electricity in a plant factory ends up.' },
        { slug: 'psychrometrics', title: 'Psychrometrics: humidity, VPD and dehumidification', minutes: 55,
          summary: 'Saturation vapour pressure, relative and absolute humidity, dew point, enthalpy, the psychrometric chart and latent loads from transpiration.' },
        { slug: 'co2-enrichment', title: 'CO₂ enrichment and ventilation', minutes: 45,
          summary: 'CO₂ fertilisation effects, the CO₂ mass balance with ventilation and uptake, dosing strategies, costs and carbon footprint.' },
        { slug: 'resource-use-efficiency', title: 'Resource-use efficiency indicators', minutes: 50,
          summary: 'Water-, energy-, light-, land- and nutrient-use efficiency; kWh per kilogram, litres per kilogram and fair comparisons with open-field production.' }
      ],
      labs: ['greenhouse-climate', 'psychrometric-chart', 'plant-factory-balance', 'co2-balance']
    },
    {
      n: 9, slug: 'sensors-iot', color: '#3a7bd5', icon: 'sensor',
      title: 'Sensors, measurement and the Internet of Things',
      tagline: 'Turning the physical world into trustworthy numbers.',
      los: ['LO4', 'LO5'],
      lessons: [
        { slug: 'sensor-physics', title: 'How sensors work: from physical quantity to signal', minutes: 60,
          summary: 'Transduction principles: thermistors and the Steinhart–Hart equation, capacitive humidity, quantum PAR sensors, NDIR CO₂ and the Beer–Lambert law, soil moisture by dielectric methods.' },
        { slug: 'electrochemical-sensors', title: 'Electrochemical sensing: pH, EC and dissolved oxygen', minutes: 55,
          summary: 'The Nernst equation and glass electrodes, conductivity cells and temperature compensation, Clark and optical dissolved-oxygen sensors.' },
        { slug: 'measurement-uncertainty', title: 'Calibration, uncertainty and data quality', minutes: 55,
          summary: 'Accuracy, precision and resolution; calibration curves; propagation of uncertainty (GUM); drift, noise, sampling theorem and filtering.' },
        { slug: 'iot-architectures', title: 'IoT architectures, networks and edge computing', minutes: 50,
          summary: 'Microcontrollers, wireless protocols (Wi-Fi, LoRaWAN, NB-IoT), MQTT, edge versus cloud processing, power budgets and cybersecurity.' }
      ],
      labs: ['sensor-bench', 'ph-calibration', 'signal-processing', 'iot-network']
    },
    {
      n: 10, slug: 'ai-data', color: '#8e4ec6', icon: 'chip',
      title: 'Artificial intelligence and data-driven cultivation',
      tagline: 'From sensor streams to decisions: models that monitor, predict and optimise.',
      los: ['LO5', 'LO4'],
      lessons: [
        { slug: 'data-to-models', title: 'From data to models: regression and growth curves', minutes: 60,
          summary: 'Mechanistic versus empirical models, least squares, logistic and Gompertz growth curves, goodness of fit, over-fitting and cross-validation.' },
        { slug: 'machine-learning', title: 'Machine learning for food production', minutes: 65,
          summary: 'Supervised and unsupervised learning, decision trees and random forests, neural networks and gradient descent, evaluation metrics and data leakage.' },
        { slug: 'computer-vision', title: 'Computer vision and plant phenotyping', minutes: 55,
          summary: 'Digital images as data, colour indices and segmentation, convolutional neural networks, disease detection and high-throughput phenotyping.' },
        { slug: 'control-optimisation', title: 'Control, optimisation and autonomous growing', minutes: 60,
          summary: 'Feedback control and PID tuning, model predictive control, reinforcement learning and the Autonomous Greenhouse Challenge.' },
        { slug: 'digital-twins', title: 'Digital twins, data governance and responsible AI', minutes: 45,
          summary: 'What a digital twin is (and is not), data ownership and sharing, bias, energy cost of AI, explainability and the EU AI Act.' }
      ],
      labs: ['model-fitting', 'neural-network', 'plant-vision', 'climate-controller', 'lettuce-digital-twin', 'sensor-anomaly']
    },
    {
      n: 11, slug: 'precision-agriculture', color: '#6b8e23', icon: 'satellite',
      title: 'Precision agriculture and remote sensing',
      tagline: 'The right input, at the right place, at the right time, in the right amount.',
      los: ['LO1', 'LO5', 'LO7'],
      lessons: [
        { slug: 'precision-farming', title: 'Principles of precision farming', minutes: 50,
          summary: 'Spatial and temporal variability, GNSS and RTK positioning, yield mapping, management zones and variable-rate application.' },
        { slug: 'remote-sensing', title: 'Remote sensing and vegetation indices', minutes: 60,
          summary: 'Spectral reflectance of vegetation, satellite, drone and proximal platforms, NDVI and related indices, spatial, spectral and temporal resolution.' },
        { slug: 'precision-irrigation', title: 'Precision irrigation and nutrient management', minutes: 55,
          summary: 'The FAO-56 soil water balance, reference evapotranspiration, crop coefficients, soil-moisture sensing and nitrogen-use efficiency.' },
        { slug: 'agricultural-robotics', title: 'Agricultural robotics and automation', minutes: 50,
          summary: 'Autonomous vehicles, weeding, spraying and harvesting robots, machine vision for crop–weed discrimination, and labour, safety and economics.' },
        { slug: 'agrivoltaics', title: 'Agrivoltaics and multifunctional land use', minutes: 45,
          summary: 'Combining photovoltaics and crops, shading and microclimate, the land equivalent ratio and trade-offs between energy and food.' }
      ],
      labs: ['drone-ndvi', 'spectral-signatures', 'irrigation-scheduling', 'field-robot', 'agrivoltaics-lab']
    },
    {
      n: 12, slug: 'alternative-proteins', color: '#c2573a', icon: 'protein',
      title: 'Alternative proteins',
      tagline: 'Plants, microbes, cells, insects and algae — new routes to protein.',
      los: ['LO1', 'LO3', 'LO6', 'LO7'],
      lessons: [
        { slug: 'protein-transition', title: 'The protein transition: nutrition and footprints', minutes: 50,
          summary: 'Protein requirements, amino-acid scores (PDCAAS, DIAAS), feed-conversion efficiency and the environmental footprints of protein sources.' },
        { slug: 'plant-based-proteins', title: 'Plant-based proteins and texturisation', minutes: 50,
          summary: 'Protein extraction and fractionation, functional properties, low- and high-moisture extrusion and the physics of fibrous structure formation.' },
        { slug: 'fermentation', title: 'Biomass and precision fermentation', minutes: 60,
          summary: 'Microbial growth kinetics (Monod), yields and productivity, mycoprotein, gas fermentation, precision fermentation and bioreactor scale-up.' },
        { slug: 'cultivated-meat', title: 'Cultivated meat and cellular agriculture', minutes: 55,
          summary: 'Cell lines, growth media, scaffolds, bioreactor constraints such as oxygen transfer and shear, techno-economic analysis and life-cycle uncertainties.' },
        { slug: 'insects-algae', title: 'Insects, microalgae and seaweed', minutes: 50,
          summary: 'Insect rearing and feed conversion, microalgae in open ponds and photobioreactors, light attenuation, seaweed aquaculture and nutritional profiles.' }
      ],
      labs: ['bioreactor', 'photobioreactor', 'extrusion', 'insect-farm', 'protein-quality', 'cultivated-meat-economics']
    },
    {
      n: 13, slug: 'consumer-acceptance', color: '#d4a017', icon: 'people',
      title: 'Consumer acceptance and sensory science',
      tagline: 'A technology that nobody wants to eat is not a solution.',
      los: ['LO4', 'LO6'],
      lessons: [
        { slug: 'food-choice', title: 'Why we eat what we eat: food choice and neophobia', minutes: 50,
          summary: 'Determinants of food choice, food neophobia and food-technology neophobia, disgust, naturalness heuristics and cultural context.' },
        { slug: 'acceptance-models', title: 'Trust, risk perception and acceptance of food technologies', minutes: 50,
          summary: 'Risk perception, trust in institutions, the theory of planned behaviour, technology acceptance models, framing and communication.' },
        { slug: 'sensory-methods', title: 'Sensory evaluation methods', minutes: 55,
          summary: 'Discrimination tests, descriptive analysis, affective (hedonic) tests, CATA and JAR scales, booth design (ISO 8589), panels and ethics.' },
        { slug: 'sensory-statistics', title: 'Designing and analysing a sensory study', minutes: 60,
          summary: 'Serving-order designs, the binomial test for triangle tests, Thurstonian d′, ANOVA of hedonic data with panellist effects, and sample size.' }
      ],
      labs: ['sensory-booth', 'triangle-test', 'hedonic-analysis', 'neophobia-scales']
    },
    {
      n: 14, slug: 'regulation-markets', color: '#4a6fa5', icon: 'scale',
      title: 'Regulation, policy and the path to market',
      tagline: 'Rules decide which innovations reach the plate.',
      los: ['LO6'],
      lessons: [
        { slug: 'eu-novel-food', title: 'The EU Novel Food Regulation', minutes: 60,
          summary: 'Regulation (EU) 2015/2283: the definition of novel food, the 15 May 1997 cut-off, categories, EFSA risk assessment, the Union list and traditional foods from third countries.' },
        { slug: 'gmo-ngt-labelling', title: 'GMOs, new genomic techniques, organics and labelling', minutes: 55,
          summary: 'The GMO framework, the new genomic techniques regulation, organic rules and hydroponics, food information to consumers and naming disputes.' },
        { slug: 'global-regulation', title: 'Global regulatory landscapes for new foods', minutes: 45,
          summary: 'Singapore, the United States (FDA/USDA, GRAS), the UK, Israel and others; bans and moratoria; regulatory divergence and trade.' },
        { slug: 'innovation-pathways', title: 'Innovation pathways: from laboratory to market', minutes: 50,
          summary: 'Technology readiness levels, the valley of death, diffusion of innovations, business models, policy instruments and the EU Farm to Fork agenda.' }
      ],
      labs: ['novel-food-navigator', 'authorisation-timeline', 'technology-diffusion']
    },
    {
      n: 15, slug: 'sustainability-assessment', color: '#2e7d6b', icon: 'compass',
      title: 'Sustainability, resilience and accessibility',
      tagline: 'Bringing it all together: is a new food system actually better — and for whom?',
      los: ['LO1', 'LO3', 'LO7'],
      lessons: [
        { slug: 'lca-emerging-systems', title: 'Life-cycle assessment of emerging food systems', minutes: 60,
          summary: 'Comparative LCA of field, greenhouse and vertical-farm production; the dominant role of energy sources; prospective LCA and its uncertainties.' },
        { slug: 'resilience', title: 'Resilience of food systems', minutes: 50,
          summary: 'Robustness, redundancy, diversity and adaptive capacity; shocks from pandemics, wars and climate extremes; the role of local and controlled production.' },
        { slug: 'accessibility-equity', title: 'Accessibility, equity and just transitions', minutes: 45,
          summary: 'Who can afford and access new food technologies; levelised cost of food; farmers, workers and the Global South; rebound effects.' },
        { slug: 'multi-criteria-assessment', title: 'Integrated multi-criteria assessment', minutes: 50,
          summary: 'Combining environmental, economic and social criteria: normalisation, weighting, MCDA methods and sensitivity analysis for technology choices.' }
      ],
      labs: ['lca-comparator', 'resilience-simulator', 'mcda-studio', 'levelised-cost']
    }
  ];

  const labs = [
    // Module 1
    { slug: 'planetary-boundaries-dashboard', module: 'foundations', kind: '2D', title: 'Planetary boundaries dashboard',
      summary: 'Adjust global diets, yields, waste and technology adoption and watch the food system move in or out of the safe operating space.', los: ['LO1', 'LO7'] },
    { slug: 'diet-footprint', module: 'foundations', kind: '2D', title: 'Diet footprint composer',
      summary: 'Compose a daily diet gram by gram and compute its land, greenhouse-gas, water and nitrogen footprint against planetary-boundary budgets.', los: ['LO1', 'LO3'] },
    { slug: 'earth-food-globe', module: 'foundations', kind: '3D', title: 'The agricultural Earth',
      summary: 'A photoreal 3D Earth showing where cropland, pasture and people are, with day–night lighting, layers and a land-budget explorer.', los: ['LO1'] },
    // Module 2
    { slug: 'leaf-photosynthesis', module: 'plant-biology', kind: '3D', title: 'Inside a photosynthesising leaf',
      summary: 'Fly into a leaf cross-section, watch CO₂ diffuse through stomata to chloroplasts, and generate light- and CO₂-response curves with the Farquhar model.', los: ['LO2', 'LO3'] },
    { slug: 'stomata-transpiration', module: 'plant-biology', kind: '3D', title: 'Stomata and transpiration',
      summary: 'Guard cells open and close in 3D as light, CO₂ and VPD change; quantify transpiration and leaf cooling with an energy balance.', los: ['LO2', 'LO3'] },
    { slug: 'nutrient-uptake-root', module: 'plant-biology', kind: '3D', title: 'Root nutrient uptake',
      summary: 'Zoom from a root system to membrane transporters; explore Michaelis–Menten uptake, depletion zones and the effect of root hairs.', los: ['LO2'] },
    { slug: 'crop-growth-model', module: 'plant-biology', kind: '2D', title: 'Crop growth model',
      summary: 'A light-use-efficiency crop model for lettuce: leaf area, light interception, biomass and relative growth rate under your chosen climate.', los: ['LO2', 'LO3', 'LO5'] },
    // Module 3
    { slug: 'experiment-designer', module: 'experimental-methods', kind: '3D', title: 'Growth-room experiment designer',
      summary: 'Lay out treatments on shelves in a 3D growth room with hidden light and temperature gradients; see how randomisation and blocking protect your conclusions.', los: ['LO4'] },
    { slug: 'statistics-workbench', module: 'experimental-methods', kind: '2D', title: 'Statistics workbench',
      summary: 'Paste your own data: descriptive statistics, t-tests, one-way ANOVA with Tukey HSD, regression, assumption checks and power analysis.', los: ['LO4', 'LO5'] },
    { slug: 'sampling-distributions', module: 'experimental-methods', kind: '2D', title: 'Sampling distributions and p-values',
      summary: 'Draw thousands of virtual samples to see the central limit theorem, confidence intervals and the true meaning of a p-value.', los: ['LO4'] },
    // Module 4
    { slug: 'grow-room-lighting', module: 'light', kind: '3D', title: 'Grow-room lighting designer',
      summary: 'Place LED fixtures above a 3D canopy, set height, power and spacing, and map PPFD, uniformity, DLI and electricity cost in real time.', los: ['LO2', 'LO3'] },
    { slug: 'spectrum-mixer', module: 'light', kind: '2D', title: 'LED spectrum mixer',
      summary: 'Blend blue, green, red, far-red and white LED channels; compute PPFD, photon efficacy, YPF, red:far-red and phytochrome photostationary state.', los: ['LO2', 'LO3'] },
    { slug: 'sun-and-dli', module: 'light', kind: '3D', title: 'Sun path and daily light integral',
      summary: 'Move a greenhouse to any latitude and date, follow the sun in 3D, and compute natural DLI and the supplementary lighting needed.', los: ['LO2', 'LO3'] },
    // Module 5
    { slug: 'soilless-systems-3d', module: 'hydroponics', kind: '3D', title: 'Soilless systems gallery',
      summary: 'Six hydroponic systems in animated 3D cut-away — NFT, DWC, ebb-and-flow, drip, wick and Kratky — with flow paths and root-zone conditions.', los: ['LO2'] },
    { slug: 'nft-system', module: 'hydroponics', kind: '3D', title: 'NFT channel simulator',
      summary: 'Nutrient film flows down a 3D gutter of lettuce; tune slope, flow and channel length and watch nutrient and oxygen depletion along the channel.', los: ['LO2', 'LO3'] },
    { slug: 'deep-water-culture', module: 'hydroponics', kind: '3D', title: 'Deep-water culture and dissolved oxygen',
      summary: 'Aerated raft culture with bubbling air stones; explore Henry’s law, temperature, aeration rate and root respiration on dissolved oxygen.', los: ['LO2', 'LO3'] },
    { slug: 'nutrient-mixer', module: 'hydroponics', kind: '2D', title: 'Nutrient-solution mixer',
      summary: 'Weigh fertiliser salts into A and B stock tanks, compute element concentrations, ion balance and EC, and detect precipitation risks.', los: ['LO2', 'LO3'] },
    { slug: 'ph-availability', module: 'hydroponics', kind: '2D', title: 'pH, speciation and nutrient availability',
      summary: 'Phosphate and carbonate speciation, iron-chelate stability and acid dosing: see why hydroponic pH is kept between 5.5 and 6.5.', los: ['LO2', 'LO3'] },
    // Module 6
    { slug: 'aquaponics-system', module: 'aquaponics', kind: '3D', title: 'Aquaponics system simulator',
      summary: 'Fish swim, bacteria nitrify and lettuce grows in a coupled 3D recirculating system driven by a live nitrogen-cycle model.', los: ['LO2', 'LO3', 'LO7'] },
    { slug: 'ammonia-toxicity', module: 'aquaponics', kind: '2D', title: 'Ammonia equilibrium and toxicity',
      summary: 'Compute the un-ionised ammonia fraction from pH and temperature and map safe operating windows for fish and nitrifiers.', los: ['LO2', 'LO3'] },
    { slug: 'nutrient-mass-balance', module: 'aquaponics', kind: '2D', title: 'Aquaponic nutrient mass balance',
      summary: 'Follow nitrogen and phosphorus from feed to fish, sludge and plants in a live Sankey diagram, and size a balanced system.', los: ['LO3', 'LO7'] },
    // Module 7
    { slug: 'aeroponic-chamber', module: 'aeroponics-vertical', kind: '3D', title: 'Aeroponic root chamber',
      summary: 'Nozzles mist a root chamber in 3D; tune droplet size, pressure and on/off cycles and watch root-surface wetness and oxygen availability.', los: ['LO2', 'LO3'] },
    { slug: 'vertical-farm-explorer', module: 'aeroponics-vertical', kind: '3D', title: 'Vertical farm explorer',
      summary: 'Walk through a multi-tier plant factory; change tiers, light intensity and HVAC and see yield, energy per kilogram and space-use efficiency.', los: ['LO1', 'LO3', 'LO7'] },
    { slug: 'life-support-loop', module: 'aeroponics-vertical', kind: '2D', title: 'Bioregenerative life-support loop',
      summary: 'Balance oxygen, CO₂, water and food for a crew on Mars: how many square metres of crops keep one astronaut alive?', los: ['LO3', 'LO7'] },
    // Module 8
    { slug: 'greenhouse-climate', module: 'climate-resources', kind: '3D', title: 'Greenhouse climate simulator',
      summary: 'A Venlo greenhouse through a full day: sun, vents, screens, heating and crop transpiration drive temperature, humidity and CO₂.', los: ['LO2', 'LO3'] },
    { slug: 'psychrometric-chart', module: 'climate-resources', kind: '2D', title: 'Interactive psychrometric chart',
      summary: 'Drag air states across the psychrometric chart; trace heating, cooling, dehumidification and transpiration processes with live property readouts.', los: ['LO3'] },
    { slug: 'plant-factory-balance', module: 'climate-resources', kind: '2D', title: 'Plant factory energy and water balance',
      summary: 'Trace every kilowatt-hour and litre through a plant factory with Sankey diagrams and compute kWh per kilogram, COP and water-use efficiency.', los: ['LO3', 'LO7'] },
    { slug: 'co2-balance', module: 'climate-resources', kind: '2D', title: 'CO₂ enrichment balance',
      summary: 'Balance CO₂ injection, ventilation losses and crop uptake to find the cost-optimal enrichment set-point.', los: ['LO3'] },
    // Module 9
    { slug: 'sensor-bench', module: 'sensors-iot', kind: '3D', title: 'Sensor bench',
      summary: 'Open up a thermistor, capacitive humidity sensor, quantum PAR sensor and NDIR CO₂ cell in 3D and see physical signal become number.', los: ['LO5'] },
    { slug: 'ph-calibration', module: 'sensors-iot', kind: '2D', title: 'pH electrode calibration',
      summary: 'Calibrate a virtual pH electrode with buffers, apply the Nernst equation and temperature compensation, and diagnose an ageing probe.', los: ['LO4', 'LO5'] },
    { slug: 'signal-processing', module: 'sensors-iot', kind: '2D', title: 'Sampling, noise and filtering',
      summary: 'Sample a noisy greenhouse signal, provoke aliasing and compare moving-average, exponential and Kalman filters.', los: ['LO5'] },
    { slug: 'iot-network', module: 'sensors-iot', kind: '2D', title: 'IoT network designer',
      summary: 'Place wireless sensor nodes on a farm, compute link budgets and battery life for Wi-Fi, BLE and LoRaWAN, and follow data to the cloud.', los: ['LO5'] },
    // Module 10
    { slug: 'model-fitting', module: 'ai-data', kind: '2D', title: 'Growth-curve model fitting',
      summary: 'Fit linear, exponential, logistic and Gompertz models to your own growth data; compare R², RMSE and AIC and cross-validate.', los: ['LO4', 'LO5'] },
    { slug: 'neural-network', module: 'ai-data', kind: '2D', title: 'Neural network playground for yield',
      summary: 'Train a small neural network in your browser to predict yield from climate data; watch the loss fall and over-fitting appear.', los: ['LO5'] },
    { slug: 'plant-vision', module: 'ai-data', kind: '2D', title: 'Plant vision lab',
      summary: 'Segment canopy images with colour indices, measure projected leaf area, detect disease lesions and evaluate a classifier with a confusion matrix.', los: ['LO5'] },
    { slug: 'climate-controller', module: 'ai-data', kind: '3D', title: 'Climate controller tuning',
      summary: 'Tune on/off, PID and predictive controllers for a 3D growth chamber and compare set-point tracking, overshoot and energy use.', los: ['LO5', 'LO3'] },
    { slug: 'lettuce-digital-twin', module: 'ai-data', kind: '3D', title: 'Lettuce digital twin',
      summary: 'A 3D lettuce driven by the Van Henten mechanistic growth model; assimilate noisy measurements and forecast the harvest date.', los: ['LO5', 'LO2'] },
    { slug: 'sensor-anomaly', module: 'ai-data', kind: '2D', title: 'Sensor anomaly detection',
      summary: 'Detect spikes, drift and stuck sensors in greenhouse data streams with rolling statistics and simple machine-learning detectors.', los: ['LO5'] },
    // Module 11
    { slug: 'drone-ndvi', module: 'precision-agriculture', kind: '3D', title: 'Drone NDVI survey',
      summary: 'Fly a multispectral drone over a variable 3D wheat field, build an NDVI map, delineate management zones and write a variable-rate prescription.', los: ['LO5', 'LO1'] },
    { slug: 'spectral-signatures', module: 'precision-agriculture', kind: '2D', title: 'Spectral signatures',
      summary: 'Explore reflectance spectra of healthy and stressed vegetation, soil and water, and see how satellite bands and vegetation indices respond.', los: ['LO5'] },
    { slug: 'irrigation-scheduling', module: 'precision-agriculture', kind: '2D', title: 'Irrigation scheduling (FAO-56)',
      summary: 'Run a daily soil-water balance with Penman–Monteith ET₀, crop coefficients and rainfall; compare calendar, sensor and model-based irrigation.', los: ['LO3', 'LO5'] },
    { slug: 'field-robot', module: 'precision-agriculture', kind: '3D', title: 'Autonomous weeding robot',
      summary: 'Drive a camera-guided robot along crop rows; tune detection thresholds and compare spot-spraying with broadcast herbicide use.', los: ['LO5', 'LO1'] },
    { slug: 'agrivoltaics-lab', module: 'precision-agriculture', kind: '3D', title: 'Agrivoltaic field designer',
      summary: 'Set panel height, tilt and row spacing over crops, trace shading through the day and compute the land equivalent ratio.', los: ['LO1', 'LO3', 'LO7'] },
    // Module 12
    { slug: 'bioreactor', module: 'alternative-proteins', kind: '3D', title: 'Stirred-tank bioreactor',
      summary: 'Run batch and fed-batch fermentation in a 3D stirred tank: Monod growth, substrate, dissolved oxygen, kLa and heat removal.', los: ['LO3', 'LO1'] },
    { slug: 'photobioreactor', module: 'alternative-proteins', kind: '3D', title: 'Microalgae photobioreactor',
      summary: 'Grow Chlorella and Spirulina in 3D tubular and flat-panel reactors; light attenuation, self-shading and areal productivity.', los: ['LO3', 'LO1'] },
    { slug: 'extrusion', module: 'alternative-proteins', kind: '3D', title: 'High-moisture extrusion',
      summary: 'Inside a twin-screw extruder and cooling die: moisture, temperature and screw speed decide whether plant protein becomes meat-like fibres.', los: ['LO1'] },
    { slug: 'insect-farm', module: 'alternative-proteins', kind: '3D', title: 'Insect farm',
      summary: 'A vertical rearing facility for mealworms and black soldier fly larvae: life cycles, feed conversion, frass and heat production.', los: ['LO1', 'LO3', 'LO7'] },
    { slug: 'protein-quality', module: 'alternative-proteins', kind: '2D', title: 'Protein quality calculator',
      summary: 'Blend plant, microbial, insect and animal proteins and compute amino-acid scores, DIAAS and complementary combinations.', los: ['LO1', 'LO3'] },
    { slug: 'cultivated-meat-economics', module: 'alternative-proteins', kind: '2D', title: 'Cultivated meat techno-economics',
      summary: 'A techno-economic model of cultivated meat: media cost, cell density, doubling time and plant scale decide the price per kilogram.', los: ['LO1', 'LO7'] },
    // Module 13
    { slug: 'sensory-booth', module: 'consumer-acceptance', kind: '3D', title: 'Sensory booth',
      summary: 'Step into an ISO 8589 sensory booth: coded samples, controlled lighting and randomised serving orders for your own tasting study.', los: ['LO4', 'LO6'] },
    { slug: 'triangle-test', module: 'consumer-acceptance', kind: '2D', title: 'Triangle test and Thurstonian d′',
      summary: 'Simulate discrimination panels, compute binomial significance and power, and convert proportion correct into d′.', los: ['LO4', 'LO6'] },
    { slug: 'hedonic-analysis', module: 'consumer-acceptance', kind: '2D', title: 'Hedonic study analyser',
      summary: 'Enter or simulate 9-point hedonic data; run ANOVA with panellist effects, Tukey comparisons and visualise liking.', los: ['LO4', 'LO6'] },
    { slug: 'neophobia-scales', module: 'consumer-acceptance', kind: '2D', title: 'Neophobia scales',
      summary: 'Take the Food Neophobia Scale and Food Technology Neophobia Scale, score them, and explore reliability and population distributions.', los: ['LO6'] },
    // Module 14
    { slug: 'novel-food-navigator', module: 'regulation-markets', kind: '2D', title: 'Novel food navigator',
      summary: 'An interactive decision tree: is your product a novel food under Regulation (EU) 2015/2283, and which route to market applies?', los: ['LO6'] },
    { slug: 'authorisation-timeline', module: 'regulation-markets', kind: '2D', title: 'Authorisation timeline simulator',
      summary: 'Simulate an EU novel food application through validity checks, EFSA assessment, clock-stops and comitology, with realistic durations.', los: ['LO6'] },
    { slug: 'technology-diffusion', module: 'regulation-markets', kind: '2D', title: 'Technology diffusion model',
      summary: 'The Bass diffusion model and S-curves: how innovation, imitation, price and regulation shape the adoption of new foods.', los: ['LO6', 'LO1'] },
    // Module 15
    { slug: 'lca-comparator', module: 'sustainability-assessment', kind: '2D', title: 'LCA comparator',
      summary: 'Compare the life-cycle footprint of lettuce from open fields, heated greenhouses and vertical farms under different electricity grids.', los: ['LO3', 'LO7'] },
    { slug: 'resilience-simulator', module: 'sustainability-assessment', kind: '2D', title: 'Food-system resilience simulator',
      summary: 'Hit a regional food network with droughts, energy crises and trade shocks; test diversity, storage and local production as buffers.', los: ['LO7'] },
    { slug: 'mcda-studio', module: 'sustainability-assessment', kind: '2D', title: 'Multi-criteria decision studio',
      summary: 'Weight environmental, economic and social criteria to rank food technologies, and stress-test the ranking with sensitivity analysis.', los: ['LO7', 'LO1'] },
    { slug: 'levelised-cost', module: 'sustainability-assessment', kind: '2D', title: 'Levelised cost of food',
      summary: 'Discounted cash-flow model of capital and operating costs: what does a kilogram of vertically farmed lettuce really cost?', los: ['LO3', 'LO7'] }
  ];

  const project = {
    title: 'Course project: grow, measure, taste',
    pages: [
      { slug: '', title: 'Project overview' },
      { slug: 'grow-system', title: 'Build your soilless system' },
      { slug: 'monitoring', title: 'Monitoring protocol' },
      { slug: 'grow-log', title: 'Grow log (data tool)' },
      { slug: 'data-analysis', title: 'Analysing your growth data' },
      { slug: 'sensory-study', title: 'Sensory study of a novel food' },
      { slug: 'sensory-designer', title: 'Sensory study designer (tool)' },
      { slug: 'report', title: 'Report, presentation and assessment' }
    ]
  };

  const schedule = [
    { week: 1, theme: 'Why food production must change', modules: ['foundations', 'plant-biology'], project: 'Form groups; choose crop and system type; safety introduction.' },
    { week: 2, theme: 'Plants and experiments', modules: ['plant-biology', 'experimental-methods'], project: 'Write hypothesis and experimental plan; build the soilless system; sow.' },
    { week: 3, theme: 'Light', modules: ['light'], project: 'Transplant (DAT 0); mix the nutrient solution; map PPFD; calibrate sensors; start the grow log and daily EC, pH, temperature and DO logging.' },
    { week: 4, theme: 'Hydroponics', modules: ['hydroponics'], project: 'Check the nutrient solution against the recipe (EC, pH drift, top-ups); first non-destructive growth measurements.' },
    { week: 5, theme: 'Aquaponics and vertical systems', modules: ['aquaponics', 'aeroponics-vertical'], project: 'Non-destructive growth measurements (image-based leaf area).' },
    { week: 6, theme: 'Climate, energy and resources', modules: ['climate-resources', 'sensors-iot'], project: 'Energy and water balance of your own system.' },
    { week: 7, theme: 'Data, sensors and AI', modules: ['sensors-iot', 'ai-data'], project: 'Fit growth models to your data; forecast harvest.' },
    { week: 8, theme: 'Precision agriculture and alternative proteins', modules: ['precision-agriculture', 'alternative-proteins'], project: 'Harvest; destructive measurements; design the sensory study.' },
    { week: 9, theme: 'People, markets and rules', modules: ['consumer-acceptance', 'regulation-markets'], project: 'Run the sensory study; analyse the data.' },
    { week: 10, theme: 'Synthesis: sustainable, resilient, accessible?', modules: ['sustainability-assessment'], project: 'Final report, poster presentation and peer review.' }
  ];

  const paths = [
    { id: 'grower', name: 'The grower', label: 'CONTROLLED ENVIRONMENTS',
      text: 'From photons and nutrients to a working system: plant physiology, light, hydroponics, aquaponics, aeroponics and climate.',
      modules: ['plant-biology', 'light', 'hydroponics', 'aquaponics', 'aeroponics-vertical', 'climate-resources'] },
    { id: 'engineer', name: 'The data engineer', label: 'SENSORS · AI · PRECISION',
      text: 'Measure, model and optimise: experiments and statistics, sensors and IoT, AI and data-driven cultivation, precision agriculture.',
      modules: ['experimental-methods', 'sensors-iot', 'ai-data', 'precision-agriculture'] },
    { id: 'analyst', name: 'The systems analyst', label: 'SOCIETY · POLICY · SUSTAINABILITY',
      text: 'Is it better, and will anyone eat it? Planetary boundaries, alternative proteins, consumer acceptance, regulation and assessment.',
      modules: ['foundations', 'alternative-proteins', 'consumer-acceptance', 'regulation-markets', 'sustainability-assessment'] }
  ];

  // ---- derived lookups -------------------------------------------------
  const lessonIndex = {};
  const flatLessons = [];
  modules.forEach(m => {
    m.lessons.forEach((l, i) => {
      l.module = m.slug; l.moduleN = m.n; l.index = i + 1;
      l.code = m.n + '.' + (i + 1);
      l.url = '/lessons/' + l.slug + '/';
      lessonIndex[l.slug] = l;
      flatLessons.push(l);
    });
  });
  const labIndex = {};
  labs.forEach(l => { l.url = '/laboratories/' + l.slug + '/'; labIndex[l.slug] = l; });
  const moduleIndex = {};
  modules.forEach(m => { moduleIndex[m.slug] = m; });

  window.FFP_COURSE = {
    name: 'Future Food Production',
    code: 'Environmental Engineering · First-cycle (bachelor) course',
    credits: '7.5 ECTS',
    outcomes, modules, labs, project, schedule, paths,
    lessonIndex, labIndex, moduleIndex, flatLessons,
    author: 'Jan Skvaril'
  };
})();
