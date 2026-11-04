// Word lists for Wordle, Hangman and Scramble. Answers are hand-picked common words (a test checks
// every one is in the dictionary); guesses and played words are checked against the dictionary in
// wordlists/dictionary.txt (one word per line, so words can simply be added there).
const fs = require('fs');
const path = require('path');
const { randomInt } = require('crypto');

const WORDLE_ANSWERS = `
about above actor adult after again agent agree ahead alarm album alert alike alive allow alone along alter amber among
angel anger angle angry apple apply arena argue arise armor array arrow aside asset audio avoid awake award aware bacon
badge baker basic basin beach beard beast begin being below bench berry birth black blade blame blank blast blaze blend
bless blind block blood bloom board boast bonus boost booth brain brake brand brave bread break brick bride brief bring
broad brook brown brush build bunch burst cabin cable camel candy canoe cargo carry catch cause chain chair chalk charm
chart chase cheap check cheek cheer chess chest chief child chill choir civic claim class clean clear clerk click cliff
climb clock close cloth cloud coach coast comet coral couch count court cover craft crane crash cream crisp crowd crown
crust curve cycle daily dance delay depth diary dizzy dough draft drain drama dream dress drift drink drive eagle early
earth eight elbow elder empty enjoy enter equal error event every exact extra fable faint faith false fancy feast fence
fever field fifty fight final flame flash fleet flint float flock flood floor flour fluid focus force forge forth frame
fresh front frost fruit funny ghost giant given glass globe glove grace grade grain grand grape graph grass great green
greet grill group guard guess guest guide habit happy harsh heart heavy hedge honey horse hotel house human humor ideal
image input irony ivory jelly jewel joint judge juice knife knock label large laser later laugh layer learn lemon level
light limit linen logic loose lucky lunar lunch magic major maker mango maple march match mayor medal metal meter minor
model money month moral motor mount mouse mouth movie music nerve never night noble noise north novel nurse ocean offer
often olive onion opera orbit order other outer owner paint panel paper party pasta patch peace peach pearl phase phone
photo piano piece pilot pitch pizza place plain plane plant plate point polar pound power press price pride prime print
prize proof proud pulse punch queen quest quick quiet quilt radio raise ranch range rapid raven reach react ready realm
rebel relax reply rider ridge right rival river roast robin robot round route royal rural salad sauce scale scarf scene
scope score scout seven shade shake shape share shark sharp sheep shelf shell shift shine shirt shock shore short shout
sight skill skirt slate sleep slice slide smart smile smoke snack snake solar solid solve sound south space spark speak
spell spend spice spine spoon sport spray squad stack staff stage stair stamp stand start steam steel stick still stone
storm story stove straw strip sugar suite sunny super swamp sweet swing sword table taste teach thank theme thick thing
think three throw thumb tiger title toast today topic torch total touch tower track trade trail train treat trend trial
tribe trick truck truly trust truth uncle under union unity upper urban usual valid value vapor video vigor visit vital
vivid vocal voice waste watch water whale wheat wheel while white whole woman world worry worth wrist write yacht young
youth zebra
`.trim().split(/\s+/);

const HANGMAN_WORDS = `
adventure airplane alphabet balloon birthday blanket bracelet butterfly calendar campfire captain carnival castle
chocolate compass cookie crystal cupcake diamond dinosaur dolphin dragon elephant festival firework flamingo football
fortress galaxy garden giraffe glacier guitar hamburger harbor harvest helmet horizon iceberg island jellyfish journey
jungle kangaroo keyboard kingdom ladder lantern library lighthouse lobster magnet meadow mermaid meteor monster mountain
mystery notebook octopus orchestra oxygen painter pancake panther parachute passport penguin pepper pirate planet
popcorn potato puzzle pyramid rainbow rocket sandwich sapphire scarecrow scissors skeleton snowflake spaceship spider
squirrel stadium strawberry submarine sunflower telescope thunder tornado treasure trophy tunnel umbrella unicorn
vampire volcano waterfall whistle wizard zombie
`.trim().split(/\s+/);

// Scramble: everyday words of 5 to 8 letters that are fair to unscramble against the clock
const SCRAMBLE_WORDS = `
apple beach bread chair cloud dance dream earth field flame fruit ghost grape heart horse house juice knife lemon light
magic money mouse music night ocean paint party piano pizza plant queen river robot salad sheep smile snake space spoon
storm sugar table tiger toast tower train water whale zebra animal basket bridge button camera candle carpet castle
cheese cookie dragon flower forest garden guitar hammer island jacket jungle kitten ladder lizard magnet marble monkey
orange parrot pencil pepper pillow planet pocket potato rabbit rocket shadow silver spider summer tomato turtle wallet
window winter wizard yellow balloon blanket cabbage captain chicken compass crystal diamond dolphin freedom giraffe
holiday kitchen lantern library monster morning octopus pancake penguin popcorn pumpkin rainbow teacher thunder tornado
unicorn volcano weather whistle alphabet backpack birthday building calendar campfire dinosaur elephant envelope
football hospital keyboard mountain notebook sandwich sunshine treasure umbrella vacation
`.trim().split(/\s+/);

let allWords = null; // Set of every dictionary word, loaded on first use
function dictionary() {
    if (!allWords) {
        const text = fs.readFileSync(path.join(__dirname, 'wordlists', 'dictionary.txt'), 'utf8');
        allWords = new Set(text.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(w => /^[a-z]+$/.test(w)));
    }
    return allWords;
}

let fiveLetters = null; // the dictionary's 5-letter words (Wordle guesses), plus every answer
function fiveLetterWords() {
    if (!fiveLetters) {
        fiveLetters = new Set([...dictionary()].filter(w => w.length === 5));
        for (const word of WORDLE_ANSWERS) fiveLetters.add(word);
    }
    return fiveLetters;
}

/** Whether a lowercase word is in the dictionary */
const isWord = (word) => dictionary().has(word);

const isValidGuess = (word) => fiveLetterWords().has(word);
const pick = (list) => list[randomInt(list.length)];

module.exports = {
    WORDLE_ANSWERS,
    HANGMAN_WORDS,
    SCRAMBLE_WORDS,
    isValidGuess,
    isWord,
    fiveLetterWords,
    randomWordleAnswer: () => pick(WORDLE_ANSWERS),
    randomHangmanWord: () => pick(HANGMAN_WORDS),
};
