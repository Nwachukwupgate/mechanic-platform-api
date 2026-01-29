import { PrismaClient, FaultCategory } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seed...')

  // Clear existing faults
  await prisma.fault.deleteMany()
  console.log('✅ Cleared existing faults')

  // Seed Faults
  const faults = [
    // ENGINE category
    {
      category: FaultCategory.ENGINE,
      name: 'Engine Won\'t Start',
      description: 'Vehicle engine fails to start when turning the key',
      questions: [
        { question: 'Does the engine make any sound when you turn the key?', type: 'yes_no' },
        { question: 'Are the dashboard lights coming on?', type: 'yes_no' },
        { question: 'When did this problem start?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.ENGINE,
      name: 'Engine Overheating',
      description: 'Engine temperature gauge shows high temperature or warning light appears',
      questions: [
        { question: 'Is there steam coming from under the hood?', type: 'yes_no' },
        { question: 'Does the temperature gauge show in the red zone?', type: 'yes_no' },
        { question: 'When did you last check the coolant level?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.ENGINE,
      name: 'Engine Misfiring',
      description: 'Engine runs rough, shakes, or loses power',
      questions: [
        { question: 'Does the check engine light appear?', type: 'yes_no' },
        { question: 'When does the misfiring occur? (idle, acceleration, etc.)', type: 'text' },
        { question: 'How long has this been happening?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.ENGINE,
      name: 'Strange Engine Noises',
      description: 'Unusual sounds coming from the engine',
      questions: [
        { question: 'What type of noise? (knocking, ticking, grinding)', type: 'text' },
        { question: 'When does the noise occur?', type: 'text' },
        { question: 'Does the noise change with engine speed?', type: 'yes_no' },
      ],
    },
    {
      category: FaultCategory.ENGINE,
      name: 'Oil Leak',
      description: 'Oil spots under the vehicle or low oil level',
      questions: [
        { question: 'Where is the oil leaking from?', type: 'text' },
        { question: 'How much oil is being lost?', type: 'text' },
        { question: 'When did you first notice the leak?', type: 'text' },
      ],
    },

    // BRAKES category
    {
      category: FaultCategory.BRAKES,
      name: 'Brake Pedal Feels Soft',
      description: 'Brake pedal goes to the floor or feels spongy',
      questions: [
        { question: 'Does the brake pedal sink to the floor?', type: 'yes_no' },
        { question: 'Have you noticed any brake fluid leaks?', type: 'yes_no' },
        { question: 'When did this problem start?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.BRAKES,
      name: 'Brake Squeaking or Grinding',
      description: 'Loud noises when applying brakes',
      questions: [
        { question: 'What type of sound? (squeaking, grinding, squealing)', type: 'text' },
        { question: 'Does it happen all the time or only sometimes?', type: 'text' },
        { question: 'When did you last replace brake pads?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.BRAKES,
      name: 'Brake Warning Light',
      description: 'Brake warning indicator on dashboard',
      questions: [
        { question: 'Is the brake warning light always on?', type: 'yes_no' },
        { question: 'Have you checked the brake fluid level?', type: 'yes_no' },
        { question: 'Are the brakes still working normally?', type: 'yes_no' },
      ],
    },
    {
      category: FaultCategory.BRAKES,
      name: 'Car Pulls to One Side When Braking',
      description: 'Vehicle veers to left or right when brakes are applied',
      questions: [
        { question: 'Which direction does the car pull?', type: 'text' },
        { question: 'Does this happen at all speeds?', type: 'yes_no' },
        { question: 'When did you first notice this?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.BRAKES,
      name: 'Brake Vibration',
      description: 'Steering wheel or vehicle shakes when braking',
      questions: [
        { question: 'Does the steering wheel shake?', type: 'yes_no' },
        { question: 'At what speed does this occur?', type: 'text' },
        { question: 'Is it worse when braking hard?', type: 'yes_no' },
      ],
    },

    // ELECTRICAL category
    {
      category: FaultCategory.ELECTRICAL,
      name: 'Battery Won\'t Charge',
      description: 'Battery dies frequently or won\'t hold a charge',
      questions: [
        { question: 'How old is the battery?', type: 'text' },
        { question: 'Does the battery die overnight?', type: 'yes_no' },
        { question: 'Are there any accessories left on?', type: 'yes_no' },
      ],
    },
    {
      category: FaultCategory.ELECTRICAL,
      name: 'Alternator Problems',
      description: 'Battery warning light or electrical issues',
      questions: [
        { question: 'Is the battery warning light on?', type: 'yes_no' },
        { question: 'Do lights dim when idling?', type: 'yes_no' },
        { question: 'When did you last replace the alternator?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.ELECTRICAL,
      name: 'Electrical Short',
      description: 'Fuses blowing frequently or electrical components not working',
      questions: [
        { question: 'Which fuses are blowing?', type: 'text' },
        { question: 'What components are not working?', type: 'text' },
        { question: 'When did this start happening?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.ELECTRICAL,
      name: 'Starter Motor Issues',
      description: 'Engine won\'t crank or makes clicking sounds',
      questions: [
        { question: 'What sound do you hear when turning the key?', type: 'text' },
        { question: 'Does it happen every time or intermittently?', type: 'text' },
        { question: 'Is the battery fully charged?', type: 'yes_no' },
      ],
    },
    {
      category: FaultCategory.ELECTRICAL,
      name: 'Power Windows Not Working',
      description: 'Windows won\'t go up or down',
      questions: [
        { question: 'Which windows are affected?', type: 'text' },
        { question: 'Do you hear any motor sounds?', type: 'yes_no' },
        { question: 'When did they stop working?', type: 'text' },
      ],
    },

    // AC category
    {
      category: FaultCategory.AC,
      name: 'AC Not Cooling',
      description: 'Air conditioning blows warm air',
      questions: [
        { question: 'Is the AC completely warm or slightly cool?', type: 'text' },
        { question: 'Does the AC work on any settings?', type: 'yes_no' },
        { question: 'When did you last recharge the AC?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.AC,
      name: 'AC Blowing Foul Odor',
      description: 'Unpleasant smell from air conditioning vents',
      questions: [
        { question: 'What type of smell? (musty, moldy, etc.)', type: 'text' },
        { question: 'Does it happen immediately or after running?', type: 'text' },
        { question: 'When did you last change the cabin air filter?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.AC,
      name: 'AC Making Noise',
      description: 'Unusual sounds from air conditioning system',
      questions: [
        { question: 'What type of noise? (rattling, squealing, etc.)', type: 'text' },
        { question: 'When does the noise occur?', type: 'text' },
        { question: 'Does the AC still cool?', type: 'yes_no' },
      ],
    },
    {
      category: FaultCategory.AC,
      name: 'AC Leaking Water',
      description: 'Water dripping inside or outside the vehicle',
      questions: [
        { question: 'Where is the water coming from?', type: 'text' },
        { question: 'How much water?', type: 'text' },
        { question: 'Does the AC still work?', type: 'yes_no' },
      ],
    },

    // TRANSMISSION category
    {
      category: FaultCategory.TRANSMISSION,
      name: 'Transmission Slipping',
      description: 'Gears slip or vehicle loses power while driving',
      questions: [
        { question: 'When does the slipping occur?', type: 'text' },
        { question: 'Does the RPM increase without acceleration?', type: 'yes_no' },
        { question: 'What type of transmission? (automatic/manual)', type: 'text' },
      ],
    },
    {
      category: FaultCategory.TRANSMISSION,
      name: 'Transmission Won\'t Shift',
      description: 'Stuck in one gear or won\'t change gears',
      questions: [
        { question: 'Which gear is it stuck in?', type: 'text' },
        { question: 'Does it happen in all driving modes?', type: 'yes_no' },
        { question: 'When did this start?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.TRANSMISSION,
      name: 'Transmission Fluid Leak',
      description: 'Red fluid leaking from vehicle',
      questions: [
        { question: 'Where is the leak coming from?', type: 'text' },
        { question: 'How much fluid is being lost?', type: 'text' },
        { question: 'When did you last check transmission fluid?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.TRANSMISSION,
      name: 'Rough Shifting',
      description: 'Harsh or jerky gear changes',
      questions: [
        { question: 'Which gears are affected?', type: 'text' },
        { question: 'Does it happen when upshifting or downshifting?', type: 'text' },
        { question: 'When did you last service the transmission?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.TRANSMISSION,
      name: 'Transmission Overheating',
      description: 'Transmission warning light or burning smell',
      questions: [
        { question: 'Is the transmission warning light on?', type: 'yes_no' },
        { question: 'Do you smell burning?', type: 'yes_no' },
        { question: 'When does this occur?', type: 'text' },
      ],
    },

    // OTHER category
    {
      category: FaultCategory.OTHER,
      name: 'Suspension Problems',
      description: 'Vehicle rides rough or makes noise over bumps',
      questions: [
        { question: 'What type of noise or issue?', type: 'text' },
        { question: 'Does the vehicle bounce excessively?', type: 'yes_no' },
        { question: 'Which side is affected?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.OTHER,
      name: 'Steering Issues',
      description: 'Steering feels loose, tight, or makes noise',
      questions: [
        { question: 'What type of steering problem?', type: 'text' },
        { question: 'Does the steering wheel vibrate?', type: 'yes_no' },
        { question: 'When did this start?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.OTHER,
      name: 'Exhaust Problems',
      description: 'Loud exhaust, smoke, or exhaust leaks',
      questions: [
        { question: 'What color is the smoke? (if any)', type: 'text' },
        { question: 'How loud is the exhaust?', type: 'text' },
        { question: 'Where is the leak coming from?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.OTHER,
      name: 'Tire Issues',
      description: 'Uneven wear, vibrations, or tire damage',
      questions: [
        { question: 'What type of tire problem?', type: 'text' },
        { question: 'Which tires are affected?', type: 'text' },
        { question: 'When did you last rotate/balance tires?', type: 'text' },
      ],
    },
    {
      category: FaultCategory.OTHER,
      name: 'Check Engine Light',
      description: 'Check engine warning light is on',
      questions: [
        { question: 'Is the light flashing or steady?', type: 'text' },
        { question: 'Are there any performance issues?', type: 'yes_no' },
        { question: 'When did the light come on?', type: 'text' },
      ],
    },
  ]

  for (const fault of faults) {
    await prisma.fault.create({
      data: fault,
    })
  }

  console.log(`✅ Seeded ${faults.length} faults`)
  console.log('🎉 Database seeding completed!')
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
