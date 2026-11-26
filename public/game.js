// Rules engine and all theme text. `blurb` is the line printed on the card's blank parchment. The server is the authority; the browser only reads ROLES/ACTIONS for labels.
(function (exports) {
  // quip: a one-liner shown in italics under the card; empty strings are skipped.
  // blockSfx: the comic stamp when this character's block holds.
  const ROLES = {
    showrunner: { name: 'Princess Donut', title: 'The Headliner', quip: '', blockSfx: 'Denied!', color: '#f5b921',
      blurb: 'Royal Tribute: Take 3 gold. Blocks Fan Donations.', text: 'Royal Tribute: take 3 gold. Blocks Fan Donations.' },
    backstabber: { name: 'Carl', title: 'The Demolitionist', quip: '', color: '#e0433f',
      blurb: 'Special Delivery: Pay 3 gold, a rival loses a card.', text: 'Special Delivery: pay 3 gold, a rival loses a card.' },
    goblin: { name: 'Mongo', title: 'The Retriever', quip: '', blockSfx: 'Mine!', color: '#7cc142',
      blurb: 'Chomp: Steal 2 gold. Blocks Chomp.', text: 'Chomp: steal 2 gold. Blocks Chomp.' },
    changeling: { name: 'Zev', title: 'The Handler', quip: '', blockSfx: 'No comment!', color: '#b07ae6',
      blurb: 'Spin Control: Swap cards with the deck. Blocks Chomp.', text: 'Spin Control: swap cards with the deck. Blocks Chomp.' },
    paparazzo: { name: 'Odette', title: 'Exposé Queen', quip: '', blockSfx: 'Not on my show!', color: '#f28c28',
      blurb: 'Exposé: Inspect a rival\'s card. Retcon: Swap 1 card. Blocks Chomp.',
      text: 'Exposé: see a rival\'s card and maybe make them redraw it. Retcon: swap 1 card with the deck. Blocks Chomp.' },
    bouncer: { name: 'Mordecai', title: 'The Alchemist', quip: '', blockSfx: 'Gulp!', color: '#4aa3e8',
      blurb: 'Antidote: Blocks Special Delivery.', text: 'Antidote: blocks Special Delivery.' },
  };

  const ACTIONS = {
    income: { name: 'Grind', text: '+1 gold' },
    aid: { name: 'Fan Donations', text: '+2 gold', blockBy: ['showrunner'], sfx: 'Cha-ching!' },
    tax: { name: 'Royal Tribute', text: '+3 gold', claim: 'showrunner', sfx: 'Bow!' },
    steal: { name: 'Chomp', text: 'Steal 2', claim: 'goblin', target: true, blockBy: ['goblin', 'changeling'], sfx: 'Chomp!' },
    exchange: { name: 'Spin Control', text: 'Swap cards', claim: 'changeling', sfx: 'Spin!' },
    assassinate: { name: 'Special Delivery', text: 'Pay 3: kill a card', claim: 'backstabber', cost: 3, target: true, blockBy: ['bouncer'], sfx: 'Kaboom!' },
    coup: { name: 'Boss Fight', text: 'Pay 7: kill a card', cost: 7, target: true, sfx: 'Boss fight!' },
  };
  // Odette variant: Odette replaces Zev (a smaller swap, plus Exposé).
  const VARIANT = {
    ...ACTIONS,
    steal: { ...ACTIONS.steal, blockBy: ['goblin', 'paparazzo'] },
    exchange: { name: 'Retcon', text: 'Swap 1 card', claim: 'paparazzo', sfx: 'Cut!' },
    examine: { name: 'Exposé', text: 'See a rival card', claim: 'paparazzo', target: true, sfx: 'Snap!' },
  };
  // The System's running commentary. {name} is replaced with the crawler in question; one line is picked at random.
  const COMMENTS = {
    caught: [
      '{name} got caught red-handed. The ratings just doubled.',
      '{name}: a liar, and not even a good one. The audience adores a bad liar.',
      'Busted! {name} should stick to honest work. Or at least better lies.',
    ],
    wrongCall: [
      '{name} called a bluff on an honest crawler. Bold. Wrong, but bold.',
      'Paranoia is not a strategy, {name}.',
      '{name} just paid for their trust issues.',
    ],
    death: [
      '{name} has been eliminated. Please hold your applause. Actually, applaud.',
      'Farewell, {name}. You will be forgotten by the next commercial break.',
      '{name} is out. The sponsors are already pretending they never met.',
    ],
    rich: [
      '{name} is sitting on a pile of gold. The audience smells a Boss Fight.',
      '{name} is rich. Being rich in a dungeon is how you get a target on your back.',
    ],
    lastTwo: [
      'Two crawlers left. Somebody get the popcorn.',
      'Final two! This is the part where friendships end.',
    ],
  };

  // Heckles a knocked-out crawler can send across everyone's screen.
  const REACTIONS = ['Boo!', 'Liar!', 'Do it!', 'Ouch!', 'RIP', 'More blood!'];
  // Opponents in a practice game.
  const BOT_NAMES = ['Sentient Toaster', 'Goblin Intern', 'Unpaid Extra', 'Floor 3 Janitor', 'Cursed Mannequin'];

  // End-of-game awards from The System. Each picks one player (or nobody) from the game's stats.
  const AWARDS = [
    { title: 'Pants on Fire', pick: (st) => top(st, s => s.lies), say: s => `${s.lies} lie${s.lies === 1 ? '' : 's'} told on live TV.` },
    { title: 'Teflon Crawler', pick: (st) => top(st, s => s.caught ? 0 : s.lies), say: s => `Lied ${s.lies} time${s.lies === 1 ? '' : 's'}. Never caught.` },
    { title: 'Lie Detector', pick: (st) => top(st, s => s.callsRight), say: s => `Called ${s.callsRight} bluff${s.callsRight === 1 ? '' : 's'} correctly.` },
    { title: 'Should Have Stayed Quiet', pick: (st) => top(st, s => s.callsWrong), say: s => `Called ${s.callsWrong} bluff${s.callsWrong === 1 ? '' : 's'} on honest crawlers.` },
    { title: 'Piñata', pick: (st) => top(st, s => s.stolenFrom), say: s => `Had ${s.stolenFrom} gold chomped.` },
    { title: 'First to Die', pick: (st, out) => out.length ? out[0] : null, say: () => 'The viewers barely learned their name.' },
  ];
  // Achievements: The System notices what you did and rewards you, sort of. Each is earned once per player,
  // from one finished game (game) or a career record (career), and pays its box's points.
  const BOXES = {
    bronze: { name: 'Bronze Box', points: 2 },
    silver: { name: 'Silver Box', points: 5 },
    gold: { name: 'Gold Box', points: 10 },
    legendary: { name: 'Legendary Box', points: 25 },
  };
  // Every achievement checks one context `x`, built from a finished game and the player's updated record:
  //   x.s: this game's stats for them (lies, caught, callsRight, callsWrong, stolenFrom, turns, honest, blocks,
  //        blockLies, blockCaught, blockedBy, stole, hits, proven, maxCoins, passes, diedCalling, diedLying, targeted,
  //        forced, spent, examined, swapsForced, a_<action> for each action used)
  //   x.won, x.cards (cards left), x.coins (gold left), x.n (players), x.place (1 = winner, n = first out)
  //   x.r: career record (games, wins), x.t: career totals of every stat above plus won/second/firstOut,
  //   x.streak / x.cold: wins / losses in a row, x.friends: different opponents, x.points, x.count: achievements held
  const ACH = (box, title, text, reward, when) => ({ box, title, text, reward, when });
  const ACHIEVEMENTS = {
    // ── The originals ──
    untouched: ACH('gold', 'Not a Scratch on You', 'You won without losing a single card. The audience feels cheated. They tuned in to watch people die, and you just... didn\'t. Selfish.', 'A strongly worded complaint from the viewers.', x => x.won && x.cards === 2),
    teflon: ACH('gold', 'Professional Liar', 'Three lies, zero consequences. Have you considered a career in politics? Or middle management? Same skill set, worse dental.', 'A fake mustache. You clearly don\'t need it.', x => x.won && x.s.lies >= 3 && !x.s.caught),
    boyscout: ACH('silver', 'Honesty Is a Terminal Condition', 'You won without telling a single lie. Statistically, this should have killed you. The System is reviewing the footage for cheating.', 'A merit badge, which The System has set on fire.', x => x.won && !x.s.lies),
    hunter: ACH('silver', 'Trust Issues', 'You called three bluffs correctly in one game. Your therapist would be proud. You don\'t have a therapist. They were all eaten on Floor Two.', 'A magnifying glass. Please stop squinting at people.', x => x.s.callsRight >= 3),
    thread: ACH('bronze', 'Held Together With Spit and Spite', 'You won with one card left. That isn\'t a victory. That\'s a near-death experience with a trophy.', 'One bandage. Used.', x => x.won && x.cards === 1),
    paranoid: ACH('bronze', 'Paranoid Little Gremlin', 'You accused two honest crawlers of lying in one game. They were telling the truth. You were the problem all along.', 'A written apology you will never send.', x => x.s.callsWrong >= 2),
    onfire: ACH('bronze', 'Pants Status: Fully Engulfed', 'Caught lying three times in one game. The fire department has been notified. Your pants are a total loss.', 'A fire extinguisher, delivered three turns too late.', x => x.s.caught >= 3),
    snack: ACH('bronze', 'All-You-Can-Eat Buffet', 'Six gold chomped out of your pockets in one game. You aren\'t a contestant. You\'re a snack with a name tag.', 'A coin purse with a hole in it.', x => x.s.stolenFrom >= 6),
    opening: ACH('bronze', 'Tutorial Boss', 'First crawler out. The viewers didn\'t even have time to learn your name. Don\'t worry. They won\'t try.', 'A commemorative urn, one size fits all.', x => x.place === x.n),
    first: ACH('bronze', 'Welcome, Crawler!', 'You finished your first game. Most crawlers do finish. Just not alive.', 'A pamphlet: "So You Survived. Now What?"', x => x.r.games >= 1),
    firstwin: ACH('silver', 'Last Crawler Standing (For Now)', 'Your first win. Enjoy it. The System has already pencilled in your humiliating downfall for next season.', 'A cardboard crown. Wear it with pride, or at least with tape.', x => x.r.wins >= 1),
    regular: ACH('silver', 'Frequent Flyer of Doom', 'Ten games played. At this point the dungeon should start charging you rent.', 'A loyalty card. Ten more games and your next coffin is free.', x => x.r.games >= 10),
    boss: ACH('gold', 'Floor Boss Material', 'Ten wins. The other crawlers have started telling their children about you. As a warning.', 'A throne. The throne is a folding chair.', x => x.r.wins >= 10),
    social: ACH('bronze', 'Collector of Future Corpses', 'You have played with five different crawlers. Lovely friends. Shame about what keeps happening to them.', 'A pack of sympathy cards, pre-signed.', x => x.friends >= 5),

    // ── How you won ──
    pacifist: ACH('silver', 'Conscientious Objector', 'You won without ever ordering a hit. Not one Special Delivery, not one Boss Fight. You let everyone else do the murdering, then strolled over their corpses to collect the prize. The System respects a freeloader.', 'A peace sign medallion, slightly bloodstained. Not your blood. That\'s the point.', x => x.won && x.s.turns >= 3 && !x.s.a_coup && !x.s.a_assassinate),
    hustle: ACH('bronze', 'Hustle Culture', 'You Grinded five times and won. You did it the honest way, one sad little coin at a time, like a LinkedIn influencer who just discovered capitalism.', 'A motivational poster of a cat hanging from a branch. The branch is on fire.', x => x.won && x.s.a_income >= 5),
    brokewin: ACH('bronze', 'Rich in Spirit', 'You won with zero gold in your pocket. Champion of the dungeon, and you can\'t even afford a sandwich. This is the most realistic depiction of fame The System has ever broadcast.', 'An IOU for one (1) sandwich. Bread not included.', x => x.won && x.coins === 0),
    hoarder: ACH('bronze', 'Dragon Sickness', 'You won sitting on ten or more gold. You could have spent it. You could have shared it. Instead you hugged it like a little goblin. Gross. Adorable. Gross.', 'A second, smaller pile of gold to sleep on.', x => x.won && x.coins >= 10),
    lastofsix: ACH('silver', 'Battle Royale Champion', 'You won a full six-crawler game. Five people walked in with you. None of them walked out. Have you considered therapy? Never mind, they\'re all dead too.', 'A sixth-place participation ribbon, which you get to give to whoever died first.', x => x.won && x.n === 6),
    duel: ACH('bronze', 'Pistols at Dawn', 'You won a one-on-one game. Just you, one other idiot, and a whole galaxy watching you two slap each other. Romantic.', 'A dueling glove. It smells like feet.', x => x.won && x.n === 2),
    speedrun: ACH('gold', 'Speedrun Any%', 'You won a game of three or more in four turns or fewer. The producers had commercials scheduled. You ruined the ad revenue. The System is furious and impressed.', 'A stopwatch that only counts down. Ominous.', x => x.won && x.n >= 3 && x.s.turns >= 1 && x.s.turns <= 4),
    marathon: ACH('silver', 'Attrition Enthusiast', 'You won after taking fifteen or more turns. The viewers went to bed. Some of them died of old age. Two got married. You were still Grinding.', 'A pillow. For the audience.', x => x.won && x.s.turns >= 15),
    pathological: ACH('gold', 'Pathological', 'Five lies in one winning game. At this point the truth is just a rumour you heard about once. Your mother would be ashamed. Your mother is watching. Hi, Mom.', 'A Pinocchio nose, extra long. You\'ll grow into it.', x => x.won && x.s.lies >= 5),
    failup: ACH('silver', 'Failing Upward', 'You got caught lying twice and still won. That isn\'t strategy, that\'s a management career. Congratulations on your promotion.', 'A corner office. The office is a closet with a sign on it.', x => x.won && x.s.caught >= 2),
    toldyou: ACH('silver', 'Told You So', 'Two crawlers called you a liar while you were telling the truth, and you won. Being right AND smug at the same time. The System hasn\'t seen a combo this good since Floor Three.', 'A trophy engraved "I Told You So." It\'s heavy enough to throw.', x => x.won && x.s.proven >= 2),
    nopenope: ACH('silver', 'Nope Nope Nope', 'You blocked three times and won. Every time someone tried to do something fun, you said no. You are the HOA of the dungeon.', 'A clipboard with a list of violations. Everyone\'s on it.', x => x.won && x.s.blocks >= 3),
    redistrib: ACH('silver', 'Wealth Redistribution', 'You stole six or more gold and won. You took from the rich, gave to yourself, and called it justice. Robin Hood is spinning in his grave. He\'s also on Floor Six now.', 'A mask. Not for disguise, just so nobody sees you smirk.', x => x.won && x.s.stole >= 6),
    postal: ACH('silver', 'Employee of the Month: Postal Division', 'Two Special Deliveries in one winning game. Neither rain nor sleet nor basic human decency stays this courier from their appointed rounds.', 'A name tag that says "Carl\'s Intern."', x => x.won && x.s.a_assassinate >= 2),
    finalboss: ACH('silver', 'Final Boss Energy', 'Two Boss Fights in one winning game. You walked up to people and simply hit them with money until they died. That\'s just how the economy works.', 'A cape. No, you can\'t have the matching theme music.', x => x.won && x.s.a_coup >= 2),
    vanilla: ACH('silver', 'Plain Vanilla Murderer', 'You won without claiming a single character. Just Grinding, donations and violence. No lies, no tricks, no personality. Like a serial killer who also does your taxes.', 'A beige T-shirt. It\'s the colour of your soul.', x => x.won && x.s.turns >= 3 && !x.s.a_tax && !x.s.a_steal && !x.s.a_exchange && !x.s.a_assassinate && !x.s.a_examine),
    crowdfund: ACH('bronze', 'Crowdfunded', 'You took Fan Donations three times and won. Your victory was paid for by sad people at home with nothing better to do. You owe them. You will never pay them back.', 'A thank-you card template. Fill it in yourself.', x => x.won && x.s.a_aid >= 3),
    mostwanted: ACH('silver', 'Most Wanted', 'Rivals came after you four or more times and you STILL won. Everybody tried to kill you. Everybody failed. The System is adding you to the "Do Not Invite" list.', 'A wanted poster with a really unflattering photo.', x => x.won && x.s.targeted >= 4),
    ghost: ACH('silver', 'Who Invited You?', 'Nobody targeted you once all game, and you won. You were so forgettable that the other crawlers didn\'t realise you were playing until the credits rolled.', 'A name tag. Please wear it. Nobody knows who you are.', x => x.won && x.n >= 3 && !x.s.targeted),
    idcrisis: ACH('bronze', 'Identity Crisis', 'Three Spin Controls in one winning game. You changed who you were so many times the audience started a betting pool. The over/under on your real personality is zero.', 'A mirror. Don\'t look too long, it gets confused.', x => x.won && x.s.a_exchange >= 3),
    royalty: ACH('bronze', 'Royalty Checks', 'Four Royal Tributes in one winning game. You demanded money for existing and people just... paid. You\'re basically a streamer now.', 'A tip jar. It\'s glued to your hand.', x => x.won && x.s.a_tax >= 4),
    cockroach: ACH('silver', 'Persistence of a Cockroach', 'You got blocked three times and won anyway. Everyone kept stepping on you and you kept crawling back. The System finds this both inspiring and deeply upsetting.', 'A tiny cockroach crown. It fits perfectly.', x => x.won && x.s.blockedBy >= 3),
    everymistake: ACH('silver', 'Every Mistake in the Book', 'You got caught lying AND you called an honest crawler a liar, then won anyway. You made every possible mistake and the universe rewarded you for it. This is why nobody believes in justice.', 'The Book. It\'s a guide to mistakes. You wrote half of it.', x => x.won && x.s.caught >= 1 && x.s.callsWrong >= 1),
    detector: ACH('silver', 'Human Lie Detector', 'You called two bluffs, were right both times, never wrong, and won. You can smell a lie from across the dungeon. The System has asked its legal team to stay away from you.', 'A polygraph machine. It beeps whenever anyone else talks.', x => x.won && x.s.callsRight >= 2 && !x.s.callsWrong),
    stalker: ACH('bronze', 'Paparazzi Pays', 'Two Exposés in a winning game. You looked at other people\'s private stuff and used it against them. Somewhere a tabloid editor is weeping with pride.', 'A telephoto lens and a restraining order. Collect both.', x => x.won && x.s.a_examine >= 2),

    // ── How you lost ──
    deathcall: ACH('bronze', 'Death by Accusation', 'You accused someone of lying on your last card. They weren\'t lying. Your final words on live television were, essentially, "I\'m an idiot." Beautiful.', 'A tombstone that reads "Was Wrong."', x => x.s.diedCalling >= 1),
    liedgrave: ACH('bronze', 'Lied to the Grave', 'You lied on your last card, got caught, and died. You committed to the bit. The bit killed you. Respect.', 'A coffin with a little fake mustache on it.', x => x.s.diedLying >= 1),
    noturn: ACH('bronze', 'Didn\'t Even Get a Turn', 'You were knocked out before you took a single action. You were a loading screen with a pulse. Now you\'re just a loading screen.', 'A ticket for one (1) turn, valid never.', x => x.place === x.n && !x.s.turns),
    cantake: ACH('bronze', 'Can\'t Take It With You', 'You died holding seven or more gold. You were saving it for something. That something was nothing. You saved it for nothing.', 'A very nice, very full wallet, buried with you.', x => !x.won && x.coins >= 7),
    firstloser: ACH('bronze', 'First Loser', 'Second place. You beat everyone except the one person who mattered. In the dungeon, second place is called "dead."', 'A silver medal made of tinfoil.', x => x.place === 2),
    atm: ACH('silver', 'Walking ATM', 'Ten or more gold stolen from you in one game. People weren\'t playing against you, they were making withdrawals. Do you charge a fee? You should charge a fee.', 'A PIN number: 0000. Everyone already knew it.', x => x.s.stolenFrom >= 10),
    punchbag: ACH('bronze', 'Everybody\'s Favourite Punching Bag', 'You were the target five or more times in one game. It wasn\'t personal. Okay, it was a little personal. Okay, everyone hates you.', 'A bullseye T-shirt. Might as well make it official.', x => x.s.targeted >= 5),
    spectator: ACH('bronze', 'Spectator With Extra Steps', 'You let fifteen or more actions happen without lifting a finger. You weren\'t playing the game, you were watching it in high definition.', 'A bucket of popcorn. Stale.', x => x.s.passes >= 15),
    conspiracy: ACH('silver', 'Conspiracy Theorist', 'Three wrong bluff calls in one game. You see liars everywhere. In the cards, in the walls, in your cereal. Have you considered that the liar is you? It isn\'t. You\'re just wrong.', 'A tinfoil hat, fitted.', x => x.s.callsWrong >= 3),
    noluck: ACH('bronze', 'Beginner\'s Luck, Minus the Luck', 'Your first and only lie of the game got caught. Your poker face has the structural integrity of a wet napkin.', 'A wet napkin.', x => x.s.lies === 1 && x.s.caught === 1),
    fakebouncer: ACH('bronze', 'Nice Try, Gate Guard', 'You bluffed a block and got caught. You stood in the doorway with your little arms out and somebody just walked through you.', 'A velvet rope. It\'s untied.', x => x.s.blockCaught >= 1),
    microscope: ACH('bronze', 'Under the Microscope', 'You were hit by two Exposés in one game. Everyone has seen your cards. Everyone has seen your soul. Neither was impressive.', 'A privacy screen. Too late.', x => x.s.examined >= 2),
    mandatory: ACH('bronze', 'Mandatory Fun', 'You had ten gold and The System made you start a Boss Fight. You didn\'t want to. It didn\'t care. Welcome to your first lesson about free will in the dungeon.', 'A permission slip, already signed by The System.', x => x.s.forced >= 1),
    inevitable: ACH('bronze', 'Statistically Inevitable', 'First out of six. One in six crawlers was always going to go first. The universe chose you. You should feel special. Don\'t.', 'A dice. All six sides say "You."', x => x.n === 6 && x.place === 6),
    honestloss: ACH('bronze', 'Honesty: Not the Best Policy', 'Three honest claims, zero lies, and you lost anyway. You did everything your kindergarten teacher told you to. Your kindergarten teacher is a f*cking liar.', 'A gold star sticker. It\'s peeling.', x => !x.won && x.s.honest >= 3 && !x.s.lies),
    natural: ACH('bronze', 'Death by Natural Causes', 'Nobody attacked you, nobody robbed you, and you still died. You did this to yourself, entirely on your own. Impressive, in a sad way.', 'A self-help book: "It Was You All Along."', x => !x.won && !x.s.targeted && x.n >= 3),
    bigspender: ACH('bronze', 'Big Spender', 'You spent fourteen or more gold in one game. Money comes, money goes, mostly into making other people sad.', 'A receipt. It\'s eleven feet long.', x => x.s.spent >= 14),
    minwage: ACH('bronze', 'Minimum Wage', 'You took at least four turns and every single one was Grind. No ambition, no dreams, just one coin at a time until death. That\'s not a game strategy, that\'s a job.', 'A name badge and a fifteen-minute break.', x => x.s.turns >= 4 && x.s.a_income === x.s.turns),
    allergic: ACH('silver', 'Allergic to the Truth', 'Three or more lies, zero honest claims. You opened your mouth and only lies came out. The System checked: you may be a politician in a crawler suit.', 'An antihistamine. It won\'t help.', x => x.s.lies >= 3 && !x.s.honest),

    // ── Big moments in one game ──
    inquisition: ACH('gold', 'The Inquisition', 'Five correct bluff calls in one game. Nobody expects you. And yet there you are, every time, pointing your bony little finger.', 'A comfy chair. It\'s for interrogations.', x => x.s.callsRight >= 5),
    buzzkill: ACH('silver', 'Professional Buzzkill', 'Five blocks in one game. Every time someone tried to have fun, there you were. Do you work for the dungeon\'s HR department? Do you WANT to?', 'A whistle. Please stop blowing it.', x => x.s.blocks >= 5),
    fakeblock: ACH('silver', 'Fake It Till You Block It', 'Three bluffed blocks in one game. You pretended to be someone tough three times. Some might call that brave. The System calls it sad cosplay.', 'A costume shop gift card.', x => x.s.blockLies >= 3),
    grandtheft: ACH('gold', 'Grand Theft Gold-o', 'Ten or more gold stolen in one game. You didn\'t play cards, you ran a heist. A crawler with sticky fingers and zero shame. The System is checking its own pockets.', 'A crowbar. For "emergencies."', x => x.s.stole >= 10),
    serial: ACH('gold', 'Serial Deliverer', 'Your attacks took three or more cards in one game. That\'s not a play style, that\'s a body count. The System has opened a file on you. It\'s thick.', 'A van with no windows. Free candy sold separately.', x => x.s.hits >= 3),
    wardrobe: ACH('bronze', 'Wardrobe Malfunction Specialist', 'You forced two rivals to redraw their cards in one game. You keep pulling off people\'s costumes in public. That\'s a crime on most planets.', 'A sewing kit. Fix what you broke.', x => x.s.swapsForced >= 2),
    dragon: ACH('silver', 'Dragon Hoard', 'You held twelve or more gold at once. Do you have any idea how hard that is in a game where everyone wants your money? Neither do we. We\'re impressed.', 'A dragon. It\'s a lizard with a cardboard wing taped on.', x => x.s.maxCoins >= 12),
    stalker2: ACH('bronze', 'Professional Stalker', 'Three Exposés in one game. You keep looking at other people\'s cards. You have a problem. It\'s called being a creep.', 'A pair of binoculars and a restraining order. Both are yours.', x => x.s.a_examine >= 3),
    commitment: ACH('bronze', 'Commitment Issues', 'Four Spin Controls in one game. You couldn\'t decide who to be, so you just kept shuffling. Your dating profile must be a nightmare.', 'A ring. You\'ll lose it.', x => x.s.a_exchange >= 4),
    honestfault: ACH('gold', 'Honest to a Fault (Theirs)', 'Three crawlers called you a liar while you were telling the truth, and every one of them lost a card for it. You didn\'t kill them. Their trust issues did.', 'A halo. It\'s a little too tight, as a treat.', x => x.s.proven >= 3),
    tribute2: ACH('bronze', 'Taxation Without Representation', 'Five Royal Tributes in one game. Nobody voted for you. Nobody wants you. You took their money anyway. Very royal of you.', 'A tiny crown and an angry mob.', x => x.s.a_tax >= 5),
    chomper: ACH('bronze', 'Chompy Chomp Chomp', 'Four Chomps in one game. You bit your way through the game like a dinosaur through a buffet line. Mongo would be proud. Mongo is always proud.', 'A dental plan. You need it.', x => x.s.a_steal >= 4),
    donation2: ACH('bronze', 'Professional Beggar', 'Four Fan Donations in one game. You held out your hat and the galaxy filled it out of pity. Pity counts as income. The System checked.', 'A hat with a hole in it. More money falls out than in.', x => x.s.a_aid >= 4),
    bigmouth: ACH('bronze', 'Can\'t Shut Up', 'Six claims in one game, true or false. You claimed to be every character in the deck at least once. Pick a lane, sweetheart.', 'A muzzle. It\'s decorative. Mostly.', x => (x.s.honest || 0) + (x.s.lies || 0) >= 6),
    silent: ACH('bronze', 'Strong, Silent Type', 'You took at least four turns and never claimed a character or blocked once. Mysterious. Brooding. Or maybe you just didn\'t read the rules.', 'A leather jacket. You\'re too cool for it.', x => x.s.turns >= 4 && !x.s.honest && !x.s.lies),
    lastsecond: ACH('silver', 'Clutch', 'You won holding one card and less than three gold. You were broke, wounded, and somehow still the last one breathing. The System is writing a movie about you. It\'s a comedy.', 'Film rights. You get none of the money.', x => x.won && x.cards === 1 && x.coins < 3),
    killsteal: ACH('bronze', 'Kill Stealer', 'You won with a Boss Fight or Special Delivery doing the final work, after everyone else softened them up. Classic vulture behaviour. The System loves a vulture.', 'A vulture feather boa.', x => x.won && x.s.hits >= 1 && x.n >= 3),
    allin: ACH('bronze', 'All In', 'You spent everything you had at least once and kept going. Nothing in your pockets but lint and spite.', 'Lint. Premium grade.', x => x.s.spent >= 7 && x.coins === 0),
    nightmare: ACH('silver', 'Everyone\'s Nightmare', 'In one game you lied, called a bluff correctly, blocked, AND stole. You did everything. You were everywhere. Nobody likes you.', 'A Swiss army knife. Every tool is a tiny middle finger.', x => x.s.lies >= 1 && x.s.callsRight >= 1 && x.s.blocks >= 1 && x.s.stole >= 1),

    // ── Career ──
    seasoned: ACH('silver', 'Seasoned Meat', '25 games played. You\'ve been in the dungeon so long, you\'re basically part of the decor. Some of the monsters have started saying hi.', 'A welcome mat with your face on it.', x => x.r.games >= 25),
    furniture: ACH('gold', 'Dungeon Furniture', '50 games played. The System has stopped thinking of you as a contestant and started thinking of you as load-bearing.', 'A couch. You are now legally the couch.', x => x.r.games >= 50),
    lifer: ACH('legendary', 'Lifer', '100 games. One hundred. Do you have a job? A family? A houseplant? The houseplant is dead. You should know that.', 'A gold watch. For your retirement. Which will never come.', x => x.r.games >= 100),
    hattrick: ACH('bronze', 'Hat Trick', 'Three career wins. You\'re officially a threat. A small, manageable threat. Like a wasp.', 'A hat. Just one. What were you expecting?', x => x.r.wins >= 3),
    favourite: ACH('gold', 'Crowd Favourite', '25 career wins. The fans adore you. The other crawlers despise you. The System is pretending not to care, but it does, a little.', 'A fan club. All members are bots.', x => x.r.wins >= 25),
    nightmare50: ACH('legendary', 'The Showrunner\'s Nightmare', '50 career wins. You keep winning. The producers keep rewriting the rules. You keep winning anyway. Stop it. No, don\'t stop. The ratings are incredible.', 'A cease and desist letter from the dungeon. Frame it.', x => x.r.wins >= 50),
    b2b: ACH('bronze', 'Back-to-Back', 'Two wins in a row. Lightning just struck twice, and the second bolt was you.', 'A lightning rod. Ironically.', x => x.streak >= 2),
    threepeat: ACH('silver', 'Three-Peat', 'Three wins in a row. The other crawlers have formed a support group. It meets on Tuesdays. You aren\'t invited.', 'A sports jersey with your name spelled wrong.', x => x.streak >= 3),
    stopthem: ACH('gold', 'Somebody Stop Them', 'Five wins in a row. The System is now legally required to consider you a natural disaster.', 'An evacuation plan, for everyone else.', x => x.streak >= 5),
    losing3: ACH('bronze', 'Losing Streak', 'Three losses in a row. It\'s fine. It\'s a phase. Like puberty, or being alive.', 'A four-leaf clover. It\'s a three-leaf clover with a leaf drawn on.', x => x.cold >= 3),
    losing5: ACH('silver', 'Participation Trophy Collector', 'Five losses in a row. The trophy shelf is filling up nicely. Every single one says "You Tried."', 'Another trophy. "You Tried." Again.', x => x.cold >= 5),
    basement: ACH('gold', 'Rock Bottom Has a Basement', 'Ten losses in a row. You found rock bottom, then you found the stairs. The System is genuinely concerned. Not concerned enough to help.', 'A shovel. Keep digging.', x => x.cold >= 10),
    compulsive: ACH('bronze', 'Compulsive', '25 career lies. Lying used to be a choice. Now it\'s just how you breathe.', 'A lie detector, broken. It gave up on you.', x => x.t.lies >= 25),
    fiction: ACH('gold', 'Fiction Writer', '100 career lies. You aren\'t a crawler, you\'re a novelist. A bad one. The System has optioned your memoir anyway.', 'A ghostwriter. They quit.', x => x.t.lies >= 100),
    bloodhound: ACH('silver', 'Bloodhound', '10 career bluffs called correctly. You can sniff out a liar at fifty paces. Also, people say you smell. Unrelated.', 'A dog collar with "Good Boy" on it.', x => x.t.callsRight >= 10),
    polygraph: ACH('gold', 'Walking Polygraph', '50 career bluffs called correctly. Lying to you is pointless. Talking to you is exhausting. Nobody invites you to parties.', 'A party invitation. It was sent to the wrong address.', x => x.t.callsRight >= 50),
    criedliar: ACH('bronze', 'The Crawler Who Cried Liar', '10 career wrong calls. Eventually you\'ll be right about someone. Probably about yourself.', 'A wolf costume. Yes, the story had a wolf. No, you didn\'t read it.', x => x.t.callsWrong >= 10),
    repeat: ACH('bronze', 'Repeat Offender', 'Caught lying 10 times across your career. The dungeon police have a punch card for you. One more and you get a free cell.', 'An orange jumpsuit. It\'s your colour.', x => x.t.caught >= 10),
    career: ACH('silver', 'Career Criminal', '25 career gold stolen. You\'ve made a life out of other people\'s pockets. Nobody can prove anything. Everybody knows.', 'A ski mask. Very fashion. Very guilty.', x => x.t.stole >= 25),
    charity: ACH('bronze', 'Charity Case', '25 career gold stolen from you. You\'re not a contestant, you\'re a non-profit. Have you considered locking your pockets?', 'A tax-deductible receipt for your losses.', x => x.t.stolenFrom >= 25),
    mailcarrier: ACH('silver', 'Mail Carrier of Death', 'Your attacks have taken 10 cards over your career. Neither rain nor snow nor begging stops you. Prompt, reliable, homicidal.', 'A little mailbag, filled with "Sorry I missed you" notes.', x => x.t.hits >= 10),
    bossrush: ACH('silver', 'Boss Rush', '10 career Boss Fights. You\'ve paid seven gold to hit someone ten different times. Your accountant is crying.', 'A boss key. It doesn\'t open anything. It just feels important.', x => x.t.a_coup >= 10),
    pearly: ACH('silver', 'Bouncer at the Pearly Gates', '20 career blocks. You decide who gets in and who doesn\'t. Spoiler: nobody gets in. Not on your watch.', 'A clipboard and a velvet rope. Power.', x => x.t.blocks >= 20),
    wageslave: ACH('bronze', 'Wage Slave', '50 career Grinds. One coin at a time, forever. The dungeon is a metaphor. You are the metaphor.', 'A time clock. Punch in. Never punch out.', x => x.t.a_income >= 50),
    donations: ACH('bronze', 'Living on Donations', '25 career Fan Donations. The galaxy has kept you alive with spare change. You are a public broadcasting station.', 'A tote bag. Thank you for your support.', x => x.t.a_aid >= 25),
    taxman: ACH('silver', 'The Taxman', '25 career Royal Tributes. You\'ve taken so much money for nothing you should be in government. You may already be. The System hasn\'t checked.', 'A tiny gavel to bang on things.', x => x.t.a_tax >= 25),
    witness: ACH('bronze', 'Witness Protection', '20 career Spin Controls. You\'ve changed identities so many times, The System isn\'t sure which one of you won this achievement.', 'A new passport. Name: "Whoever."', x => x.t.a_exchange >= 20),
    neverlearns: ACH('bronze', 'Never Learns', 'Died calling a bluff three times across your career. You keep pointing. They keep being honest. You keep dying. It\'s a cycle. A sh*tty one.', 'A sign that says "Maybe Don\'t."', x => x.t.diedCalling >= 3),
    liedtildeath: ACH('bronze', 'Lies Till Death, Repeatedly', 'Died lying three times across your career. At least you\'re consistent. Consistently dead.', 'A pre-paid funeral plan. Platinum tier.', x => x.t.diedLying >= 3),
    influencer: ACH('silver', 'Influencer', 'You have played with ten different crawlers. You have a following. The following is mostly corpses, but numbers are numbers.', 'A ring light. Everyone looks dead in it anyway.', x => x.friends >= 10),
    cult: ACH('gold', 'Cult Leader', 'You have played with twenty different crawlers. They keep coming back. Why do they keep coming back? What are you putting in the punch?', 'A robe. Very flowy. Very sinister.', x => x.friends >= 20),
    lootgoblin: ACH('silver', 'Loot Goblin', '100 points banked. You love boxes. You love points. You don\'t even know what they\'re for yet. Neither does The System, but it\'s not telling you that.', 'A box. It contains a smaller box.', x => x.points >= 100),
    boxhoarder: ACH('gold', 'Box Hoarder', '500 points banked. You have more boxes than friends. You have more boxes than most planets.', 'A storage unit. Rent is due.', x => x.points >= 500),
    hunter25: ACH('silver', 'Achievement Hunter', '25 achievements. You\'re not playing the game anymore, you\'re playing The System. The System finds this flattering and a little creepy.', 'A checklist. Only 75% of the boxes are judging you.', x => x.count >= 25),
    completionist: ACH('gold', 'Completionist Wannabe', '50 achievements. You want them all. You NEED them all. The System is starting to worry about you, and The System doesn\'t worry about anything.', 'A trophy cabinet. It\'s already full of other people\'s trophies.', x => x.count >= 50),
    favouritepet: ACH('legendary', 'The System\'s Favourite Pet', '100 achievements. The System has decided to keep you. You will be fed. You will be groomed. You will never, ever leave.', 'A collar with a bell. You\'ll get used to it.', x => x.count >= 100),
    profloser: ACH('silver', 'Professional Loser', '25 career losses. You lose so consistently that bookies use you as a benchmark. That\'s a kind of fame.', 'A loser\'s bracket all your own.', x => x.r.games - x.r.wins >= 25),
    bridesmaid: ACH('silver', 'Always the Bridesmaid', 'Five second-place finishes. So close, so many times. The universe is clearly f*cking with you specifically.', 'A bouquet. You caught it. Again.', x => x.t.second >= 5),
    tutorial5: ACH('bronze', 'Tutorial Boss, Repeatedly', 'First one out five times. You\'re less of a contestant and more of a warm-up act. The crowd uses you to test the cameras.', 'A test pattern with your face on it.', x => x.t.firstOut >= 5),
    overexposed: ACH('bronze', 'Overexposed', 'Hit by ten Exposés across your career. Everybody has seen your cards. You have no secrets left. You never had good ones.', 'A trench coat. Hide what\'s left.', x => x.t.examined >= 10),
    integrity: ACH('silver', 'Integrity Speedrun', '50 honest claims across your career. You told the truth fifty times in a game built on lying. The System genuinely does not know what to do with you.', 'A Boy Scout uniform, sized for a large adult.', x => x.t.honest >= 50),
    ninelives: ACH('silver', 'Nine Lives', 'Won nine games with one card left, across your career. You are a cat. A wounded, stubborn, filthy cat.', 'A litter box. Commemorative.', x => x.t.clutch >= 9),
    marked: ACH('bronze', 'Marked for Death', 'Targeted 25 times over your career. You aren\'t a crawler, you\'re a dartboard with legs.', 'A helmet. Too little, too late.', x => x.t.targeted >= 25),
    blockedalot: ACH('bronze', 'Rejection Collector', 'Your moves have been blocked 25 times across your career. You keep trying. They keep saying no. It\'s like dating, but with more blood.', 'A box of tissues. Extra strength.', x => x.t.blockedBy >= 25),
    sticky: ACH('gold', 'Sticky Fingers Hall of Fame', '100 career gold stolen. You\'ve robbed so many crawlers they\'ve started paying you in advance to save time.', 'A golden glove. It\'s stolen. Obviously.', x => x.t.stole >= 100),
    exposer: ACH('silver', 'Investigative Journalist', '15 career Exposés. You\'ve uncovered more secrets than a gossip column. Most of them were boring.', 'A press pass. It\'s fake. Like everything else.', x => x.t.a_examine >= 15),
    winner50: ACH('silver', 'Better Than a Coin Flip', 'At least 20 games played and you\'ve won more than half of them. You\'re statistically better than random chance. Barely.', 'A coin. Heads you win. Tails you also win.', x => x.r.games >= 20 && x.r.wins * 2 > x.r.games),
    broke10: ACH('bronze', 'Chronically Broke', 'Ended ten games with zero gold. You are the dungeon\'s poverty line.', 'A begging bowl, slightly chipped.', x => x.t.broke >= 10),
  };
  // Achievements seat i newly earns from a finished game, given their updated record and what they already have.
  // `t` is the career totals (tally() summed), `streak`/`cold` the run of wins/losses, `friends` the opponents met.
  function achievementsFor(g, i, record, friends, have = {}, points = 0) {
    const s = g.stats[i], n = g.players.length, won = g.winner === i;
    const x = { s, won, n, cards: live(g.players[i]), coins: g.players[i].coins, place: placeOf(g, i), r: record, t: record.t || {},
      streak: record.streak || 0, cold: record.cold || 0, friends, points, count: Object.keys(have).length };
    return Object.keys(ACHIEVEMENTS).filter(k => !have[k] && ACHIEVEMENTS[k].when(x));
  }
  // 1 = winner, n = first out. Players never knocked out (only the winner) count as 1.
  const placeOf = (g, i) => g.winner === i ? 1 : g.players.length - g.out.indexOf(i);
  // One game's stats for seat i, plus a few derived ones, ready to add into career totals.
  function tally(g, i) {
    const won = g.winner === i;
    return { ...g.stats[i], won: +won, second: +(placeOf(g, i) === 2), firstOut: +(g.out[0] === i),
      clutch: +(won && live(g.players[i]) === 1), broke: +(g.players[i].coins === 0) };
  }

  // Index of the single highest score above zero; ties give nobody the award.
  function top(stats, score) {
    const scores = stats.map(score), best = Math.max(...scores);
    return best > 0 && scores.filter(x => x === best).length === 1 ? scores.indexOf(best) : null;
  }
  const awards = (stats, out) => AWARDS.map(a => ({ a, id: a.pick(stats, out) })).filter(x => x.id != null)
    .map(({ a, id }) => ({ title: a.title, id, text: a.say(stats[id]) }));

  const actionsFor = variant => variant ? VARIANT : ACTIONS;
  const rolesFor = variant => Object.keys(ROLES).filter(r => r !== (variant ? 'changeling' : 'paparazzo'));
  const A = g => actionsFor(g.variant);

  const alive = p => p.cards.some(c => !c.revealed);
  const holds = (p, role) => p.cards.find(c => !c.revealed && c.role === role);
  const say = (g, text) => { g.log.push(text); };
  // What just happened, for the phones to animate. Replaced on every move; `seq` tells phones it is new.
  // Bluffs called, Exposés and eliminations are also kept for the end-of-game highlight reel.
  const emit = (g, e) => { g.ev.push(e); if (['challenge', 'expose', 'out'].includes(e.type)) g.reel.push(e); };
  const comment = (g, kind, id) => { const lines = COMMENTS[kind]; say(g, lines[Math.floor(g.rng() * lines.length)].replace('{name}', id == null ? '' : g.players[id].name)); };
  // Stats for awards and achievements. Missing keys count as 0, so games saved before a stat existed still work.
  const bump = (g, i, k, n = 1) => { g.stats[i][k] = (g.stats[i][k] || 0) + n; };
  const live = p => p.cards.filter(c => !c.revealed).length;
  const gold = (g, from, to, n) => { if (n > 0) emit(g, { type: 'gold', from, to, n }); }; // from/to null = the bank

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newGame(names, rng = Math.random, variant = false) {
    const g = { rng, variant, peekCard: null, log: [], ev: [{ type: 'deal' }], seq: 1, out: [], reel: [], rich: [], phase: 'turn', cur: null, block: null, waiting: [], canChallenge: false, loser: null, offer: null, after: null, winner: null };
    g.deck = shuffle(rolesFor(variant).flatMap(r => [r, r, r]), rng);
    g.players = names.map((name, id) => ({
      id, name, coins: 2,
      cards: [g.deck.pop(), g.deck.pop()].map(role => ({ role, revealed: false })),
    }));
    g.stats = g.players.map(() => ({ lies: 0, caught: 0, callsRight: 0, callsWrong: 0, stolenFrom: 0 })); // for the end-of-game awards
    g.turn = Math.floor(rng() * names.length);
    say(g, `Welcome, Crawlers! ${g.players[g.turn].name} goes first. Now get out there and kill, kill, kill!`);
    return g;
  }

  function reveal(g, p, card) {
    card.revealed = true;
    const what = ROLES[card.role].name;
    say(g, alive(p) ? `${p.name} loses their ${what}.` : `${p.name} loses their ${what} and is DEAD. The viewers love it.`);
    if (!alive(p)) {
      g.out.push(p.id); emit(g, { type: 'out', id: p.id });
      const left = g.players.filter(alive).length;
      if (left > 1) comment(g, left === 2 ? 'lastTwo' : 'death', p.id);
    }
  }

  // Player loses a card: asks them to pick if they still have two, then carries on with `next`.
  // `next` is a name, not a function, so a paused game is plain data that can be saved and restored.
  function lose(g, pid, next) {
    const p = g.players[pid], left = p.cards.filter(c => !c.revealed);
    if (left.length === 2) { g.phase = 'lose'; g.loser = pid; g.after = next; return; }
    if (left.length) reveal(g, p, left[0]);
    proceed(g, next);
  }

  function blocked(g) {
    say(g, `${A(g)[g.cur.action].name} is blocked.`);
    bump(g, g.cur.actor, 'blockedBy');
    emit(g, { type: 'sfx', text: ROLES[g.block.role].blockSfx || 'Blocked!', block: g.block.role, actor: g.block.by });
  }

  // What happens after a card is lost. 'block:…' and 'action:…' follow a called bluff on a block or an action.
  function proceed(g, next) {
    const c = g.cur, a = c && A(g)[c.action];
    if (next === 'block:held') { blocked(g); return endTurn(g); }
    if (next === 'block:lie') return resolve(g);
    if (next === 'action:held') return a.blockBy ? openReact(g, false) : resolve(g);
    if (next === 'action:lie') { // caught bluffing: the action never happened
      g.players[c.actor].coins += a.cost || 0;
      gold(g, null, c.actor, a.cost || 0);
    }
    endTurn(g);
  }

  // `on` is 'block' or 'action': which claim was called.
  function challenge(g, challengerId, claimantId, role, on) {
    const ch = g.players[challengerId], cl = g.players[claimantId], card = holds(cl, role);
    emit(g, { type: 'challenge', by: challengerId, claimant: claimantId, role, held: !!card });
    g.stats[challengerId][card ? 'callsWrong' : 'callsRight']++;
    if (!card) g.stats[claimantId].caught++;
    if (card) { bump(g, claimantId, 'proven'); if (live(ch) === 1) bump(g, challengerId, 'diedCalling'); }
    else { if (on === 'block') bump(g, claimantId, 'blockCaught'); if (live(cl) === 1) bump(g, claimantId, 'diedLying'); }
    if (card) {
      say(g, `${ch.name} calls the bluff. ${cl.name} really is the ${ROLES[role].name}. Awkward.`);
      comment(g, 'wrongCall', challengerId);
      g.deck.push(card.role); shuffle(g.deck, g.rng); card.role = g.deck.pop();
      lose(g, challengerId, `${on}:held`);
    } else {
      say(g, `${ch.name} calls the bluff. ${cl.name} was lying!`);
      comment(g, 'caught', claimantId);
      lose(g, claimantId, `${on}:lie`);
    }
  }

  function openReact(g, canChallenge) {
    const c = g.cur, a = A(g)[c.action];
    if (!alive(g.players[c.actor])) return endTurn(g); // actor was removed mid-action
    g.phase = 'react'; g.canChallenge = canChallenge;
    g.waiting = g.players
      .filter(p => alive(p) && p.id !== c.actor && (canChallenge || (a.blockBy && (c.target == null || c.target === p.id))))
      .map(p => p.id);
    if (!g.waiting.length) resolve(g);
  }

  function finish(g) {
    const living = g.players.filter(alive);
    if (living.length !== 1) return false;
    g.phase = 'over'; g.winner = living[0].id;
    say(g, `${living[0].name} is the Last Crawler Standing!`);
    return true;
  }

  function endTurn(g) {
    g.cur = g.block = g.offer = g.loser = g.peekCard = null; g.waiting = [];
    if (finish(g)) return;
    for (const p of g.players) g.stats[p.id].maxCoins = Math.max(g.stats[p.id].maxCoins || 0, p.coins);
    for (const p of g.players) if (alive(p) && p.coins >= 7 && !g.rich.includes(p.id)) { g.rich.push(p.id); comment(g, 'rich', p.id); }
    do g.turn = (g.turn + 1) % g.players.length; while (!alive(g.players[g.turn]));
    g.phase = 'turn';
  }

  function resolve(g) {
    const c = g.cur, p = g.players[c.actor], t = g.players[c.target];
    if (!alive(p)) return endTurn(g); // actor was removed mid-action
    if (A(g)[c.action].sfx) emit(g, { type: 'sfx', text: A(g)[c.action].sfx, action: c.action, actor: p.id, target: c.target });
    switch (c.action) {
      case 'income': p.coins += 1; gold(g, null, p.id, 1); break;
      case 'aid': p.coins += 2; gold(g, null, p.id, 2); break;
      case 'tax': p.coins += 3; gold(g, null, p.id, 3); break;
      case 'steal': { const n = Math.min(2, t.coins); t.coins -= n; p.coins += n; gold(g, t.id, p.id, n); g.stats[t.id].stolenFrom += n; bump(g, p.id, 'stole', n); break; }
      case 'coup': case 'assassinate':
        if (alive(t)) bump(g, p.id, 'hits');
        say(g, `${A(g)[c.action].name} lands on ${t.name}.`);
        return lose(g, c.target, 'end');
      case 'exchange':
        g.offer = [...p.cards.filter(x => !x.revealed).map(x => x.role), g.deck.pop()];
        if (!g.variant) g.offer.push(g.deck.pop());
        g.phase = 'exchange';
        return;
      case 'examine': { // target picks which card to show; with one card left there is no choice
        const left = t.cards.map((x, i) => x.revealed ? -1 : i).filter(i => i >= 0);
        if (!left.length) break;
        if (left.length === 1) { g.peekCard = left[0]; g.phase = 'peek'; } else g.phase = 'show';
        return;
      }
    }
    endTurn(g);
  }

  // Apply one player's move. Returns an error string, or undefined on success.
  function act(g, pid, m) {
    const p = g.players[pid];
    if (!p || !m || typeof m !== 'object') return 'Bad move';
    if (!alive(p)) return 'You are dead';
    g.ev = []; g.seq++;
    const c = g.cur, a = c && A(g)[c.action];

    if (g.phase === 'turn') {
      if (pid !== g.turn || m.type !== 'action' || !Object.hasOwn(A(g), m.action)) return 'Not your move';
      const act = A(g)[m.action];
      if (p.coins >= 10 && m.action !== 'coup') return `With 10+ gold you must ${A(g).coup.name}`;
      if (p.coins < (act.cost || 0)) return 'Not enough gold';
      const t = act.target && Number.isInteger(m.target) ? g.players[m.target] : null;
      if (act.target && (!t || t === p || !alive(t))) return 'Pick a living rival';
      if (m.action === 'coup' && p.coins >= 10) bump(g, pid, 'forced');
      p.coins -= act.cost || 0;
      gold(g, pid, null, act.cost || 0);
      bump(g, pid, 'turns'); bump(g, pid, `a_${m.action}`); bump(g, pid, 'spent', act.cost || 0);
      if (t) bump(g, t.id, 'targeted');
      if (act.claim && holds(p, act.claim)) bump(g, pid, 'honest');
      if (act.claim && !holds(p, act.claim)) g.stats[pid].lies++;
      g.cur = { action: m.action, actor: pid, target: t ? t.id : null };
      say(g, `${p.name} goes for ${act.name}${t ? ` on ${t.name}` : ''}${act.claim ? `, claiming ${ROLES[act.claim].name}` : ''}.`);
      if (act.claim || act.blockBy) openReact(g, !!act.claim); else resolve(g);
      return;
    }

    if (g.phase === 'react' || g.phase === 'blockReact') {
      const i = g.waiting.indexOf(pid);
      if (i < 0) return 'Not your move';
      const blocking = g.phase === 'blockReact';
      if (m.type === 'pass') {
        bump(g, pid, 'passes');
        g.waiting.splice(i, 1);
        if (!g.waiting.length) {
          if (blocking) { blocked(g); endTurn(g); } else resolve(g);
        }
        return;
      }
      if (m.type === 'challenge') {
        if (blocking) {
          return challenge(g, pid, g.block.by, g.block.role, 'block');
        }
        if (!g.canChallenge) return 'Nothing to challenge';
        return challenge(g, pid, c.actor, a.claim, 'action');
      }
      if (m.type === 'block' && !blocking) {
        if (!a.blockBy || !a.blockBy.includes(m.role) || (c.target != null && c.target !== pid)) return 'You cannot block that';
        g.block = { by: pid, role: m.role };
        bump(g, pid, 'blocks'); bump(g, pid, holds(p, m.role) ? 'honest' : 'blockLies');
        if (!holds(p, m.role)) g.stats[pid].lies++;
        say(g, `${p.name} blocks, claiming ${ROLES[m.role].name}.`);
        g.phase = 'blockReact';
        g.waiting = g.players.filter(x => alive(x) && x.id !== pid).map(x => x.id);
        return;
      }
      return 'Bad move';
    }

    if (g.phase === 'lose') {
      const card = Number.isInteger(m.card) ? p.cards[m.card] : null;
      if (pid !== g.loser || m.type !== 'lose' || !card || card.revealed) return 'Not your move';
      reveal(g, p, card);
      const next = g.after; g.after = g.loser = null;
      proceed(g, next);
      return;
    }

    if (g.phase === 'exchange') {
      const mine = p.cards.filter(x => !x.revealed), keep = m.keep;
      if (pid !== c.actor || m.type !== 'exchange') return 'Not your move';
      if (!Array.isArray(keep) || keep.length !== mine.length || new Set(keep).size !== keep.length ||
          keep.some(k => !Number.isInteger(k) || k < 0 || k >= g.offer.length)) return `Keep exactly ${mine.length}`;
      mine.forEach((card, n) => { card.role = g.offer[keep[n]]; });
      g.deck.push(...g.offer.filter((_, k) => !keep.includes(k)));
      shuffle(g.deck, g.rng);
      endTurn(g);
      return;
    }

    if (g.phase === 'show') {
      const card = Number.isInteger(m.card) ? p.cards[m.card] : null;
      if (pid !== c.target || m.type !== 'show' || !card || card.revealed) return 'Not your move';
      g.peekCard = m.card; g.phase = 'peek';
      return;
    }

    if (g.phase === 'peek') {
      if (pid !== c.actor || m.type !== 'peek') return 'Not your move';
      const t = g.players[c.target], card = t.cards[g.peekCard];
      emit(g, { type: 'expose', by: pid, target: t.id, swap: !!(m.swap && !card.revealed) });
      bump(g, t.id, 'examined'); if (m.swap && !card.revealed) bump(g, pid, 'swapsForced');
      if (m.swap && !card.revealed) {
        g.deck.push(card.role); shuffle(g.deck, g.rng); card.role = g.deck.pop();
        say(g, `${p.name} didn't like what they saw. ${t.name} redraws that card.`);
      } else say(g, `${p.name} takes a good look and lets ${t.name} keep it.`);
      endTurn(g);
      return;
    }

    return 'Game over';
  }

  // What one player is allowed to see.
  function view(g, pid) {
    const seated = g.players[pid]; // no seat (pid -1) is the TV view: no hidden cards until the game is over
    const spectator = g.phase === 'over' || (seated && !alive(seated));
    return {
      phase: g.phase, turn: g.turn, cur: g.cur, block: g.block, waiting: g.waiting, canChallenge: g.canChallenge,
      loser: g.loser, winner: g.winner, log: g.log.slice(-40), ev: g.ev, seq: g.seq, out: g.out,
      stats: g.phase === 'over' ? g.stats : null, reel: g.phase === 'over' ? g.reel : null,
      offer: g.phase === 'exchange' && g.cur.actor === pid ? g.offer : null,
      variant: g.variant,
      peek: g.phase === 'peek' ? { card: g.peekCard, role: g.cur.actor === pid ? g.players[g.cur.target].cards[g.peekCard].role : null } : null,
      players: g.players.map(p => ({
        id: p.id, name: p.name, coins: p.coins,
        // Knocked-out players, and everyone once the game is over, may watch with every card face up.
        cards: p.cards.map(c => ({ revealed: c.revealed, role: c.revealed || p.id === pid || spectator ? c.role : null })),
      })),
    };
  }

  // Ids of the players the game cannot continue without.
  function waitingOn(g) {
    if (g.phase === 'turn') return [g.turn];
    if (g.phase === 'react' || g.phase === 'blockReact') return g.waiting.slice();
    if (g.phase === 'lose') return [g.loser];
    if (g.phase === 'exchange' || g.phase === 'peek') return [g.cur.actor];
    if (g.phase === 'show') return [g.cur.target];
    return [];
  }

  // The dullest legal move, for a player who ran out of time or left.
  function autoMove(g, pid) {
    const p = g.players[pid];
    if (g.phase === 'turn') {
      const rival = g.players.find(x => x !== p && alive(x));
      return act(g, pid, p.coins >= 10 ? { type: 'action', action: 'coup', target: rival.id } : { type: 'action', action: 'income' });
    }
    if (g.phase === 'lose') return act(g, pid, { type: 'lose', card: p.cards.findIndex(c => !c.revealed) });
    if (g.phase === 'show') return act(g, pid, { type: 'show', card: p.cards.findIndex(c => !c.revealed) });
    if (g.phase === 'peek') return act(g, pid, { type: 'peek', swap: false });
    if (g.phase === 'exchange') return act(g, pid, { type: 'exchange', keep: p.cards.filter(c => !c.revealed).map((_, i) => i) });
    return act(g, pid, { type: 'pass' });
  }

  // Remove a player mid-game: settle anything they owe, then kill their cards.
  function forfeit(g, pid) {
    const p = g.players[pid];
    for (let n = 0; n < 10 && waitingOn(g).includes(pid); n++) autoMove(g, pid);
    if (g.phase === 'over' || !alive(p)) return;
    p.cards.forEach(c => { c.revealed = true; });
    g.out.push(pid); emit(g, { type: 'out', id: pid });
    say(g, `${p.name} has been dragged off the show.`);
    if (g.phase === 'turn') finish(g);
    else if (g.cur.actor === pid && g.phase !== 'lose') endTurn(g); // their pending action dies with them
  }

  // A game read back from disk: everything is plain data except the shuffler, which is reattached here.
  const revive = (g, rng = Math.random) => Object.assign(g, { rng });

  Object.assign(exports, { revive, ROLES, ACTIONS, REACTIONS, BOT_NAMES, ACHIEVEMENTS, BOXES, achievementsFor, tally, actionsFor, rolesFor, awards, newGame, act, view, waitingOn, autoMove, forfeit });
})(typeof module !== 'undefined' ? module.exports : (window.Game = {}));
