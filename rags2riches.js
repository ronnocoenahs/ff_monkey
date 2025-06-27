// ==UserScript==
// @name         FunFile Rags To Riches Blackjack
// @namespace    http://tampermonkey.net/
// @version      1.9 // Increased version for stretched stats, prompt after game open, and confirmed no-text background
// @description  A client-side Blackjack game against 'Mugiwara' with betting, a poker table theme, win/loss tracking, and manual credit transfers.
// @author       Gemini
// @match        https://www.funfile.org/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- Game Configuration ---
    const DEALER_NAME = "Mugiwara";
    const DEALER_IMAGE_URL = "https://ptpimg.me/95xrpn.jpg"; // Mugiwara's image URL
    const PLAYER_AVATAR_PLACEHOLDER_URL = "https://placehold.co/100x100/333/ecf0f1?text=YOU"; // Placeholder for player avatar
    // These multipliers are for display and calculation within the game.
    // Actual transfers are done manually via mycredits.php.
    const BLACKJACK_PAYOUT_MULTIPLIER = 1.5; // Blackjack typically pays 3:2 (1.5x bet)
    const REGULAR_WIN_MULTIPLIER = 1;       // Regular win pays 1:1 (1x bet)
    const BET_TIMEOUT_MS = 10000; // 10 seconds for bet input

    // --- Greasemonkey Storage Keys for Pending Transfers ---
    const STORAGE_KEY_PENDING_CREDIT = 'ff_blackjack_pending_credit';
    const STORAGE_KEY_RECIPIENT = 'ff_blackjack_recipient';
    const STORAGE_KEY_AMOUNT = 'ff_blackjack_amount';
    const STORAGE_KEY_REASON = 'ff_blackjack_reason';

    // --- Blackjack Game Variables ---
    let deck = [];
    let playerHand = [];
    let dealerHand = [];
    let gameOver = false;
    let currentBet = 0;
    let currentUsersCredits = 0; // Displayed credits within the game
    let actualUsersUsername = ''; // To store the current logged-in user's username
    let wins = 0; // Track wins
    let losses = 0; // Track losses
    let totalEarned = 0; // Track total credits earned in game
    let totalLost = 0;   // Track total credits lost in game
    let betTimeoutId = null; // To store the timeout for bet prompt

    // --- UI Elements (will be populated once the DOM is ready) ---
    let gameModal, dealerHandDiv, dealerScoreDiv, playerHandDiv, playerScoreDiv, gameMessageDiv, hitBtn, standBtn, newGameBtn;
    let currentCreditsDisplay, winsDisplayElement, lossesDisplayElement, totalEarnedDisplay, totalLostDisplay, transferCreditsBtn;
    let closeButtonX; // The new 'X' close button
    let rags2RichesTitle; // For the text in the middle of the table

    // --- Card Deck Logic ---
    const suits = ['♥', '♦', '♣', '♠']; // Heart, Diamond, Club, Spade emojis
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    // Creates a new 52-card deck
    function createDeck() {
        deck = [];
        for (let suit of suits) {
            for (let rank of ranks) {
                deck.push({ rank, suit });
            }
        }
        shuffleDeck();
    }

    // Shuffles the deck using Fisher-Yates algorithm
    function shuffleDeck() {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]]; // Swap elements
        }
    }

    // Deals a single card from the deck
    function dealCard() {
        if (deck.length === 0) {
            createDeck(); // Reshuffle if deck is empty
            console.warn("Deck ran out, reshuffling!");
        }
        return deck.pop();
    }

    // Calculates the score of a hand, handling Aces (1 or 11)
    function getHandValue(hand) {
        let value = 0;
        let aceCount = 0;

        for (let card of hand) {
            if (card.rank === 'A') {
                aceCount++;
                value += 11;
            } else if (['K', 'Q', 'J'].includes(card.rank)) {
                value += 10;
            } else {
                value += parseInt(card.rank);
            }
        }

        // Adjust for Aces if busting
        while (value > 21 && aceCount > 0) {
            value -= 10;
            aceCount--;
        }
        return value;
    }

    // Converts a card object to its display string
    function getCardDisplay(card) {
        return `<div class="card-rank">${card.rank}</div><div class="card-suit ${ (card.suit === '♥' || card.suit === '♦') ? 'red-suit' : ''}">${card.suit}</div>`;
    }

    // --- DOM Parsing for User Credits ---
    function readUserCreditsFromPage() {
        // Look for the specific div that contains the user's information on the main page
        const userInfoDiv = document.querySelector('div[style*="float: left; margin: 5px 0 0 14px;"]');

        if (userInfoDiv) {
            // Get the username (bold link)
            const usernameLink = userInfoDiv.querySelector('a[style*="font-weight: bold;"]');
            if (usernameLink) {
                actualUsersUsername = usernameLink.textContent.trim();
            }

            // Within this div, find the 'a' tag that contains 'cr.' (for credits)
            const creditLink = userInfoDiv.querySelector('a[href*="mycredits.php"]');
            if (creditLink) {
                const creditText = creditLink.textContent;
                const creditMatch = creditText.match(/(\d[\d,]*\.?\d*)\s*cr\./i);
                if (creditMatch && creditMatch[1]) {
                    let creditAmount = parseFloat(creditMatch[1].replace(/,/g, ''));
                    currentUsersCredits = creditAmount; // Set initial credits for game
                    return creditAmount;
                }
            }
        }
        console.warn("FunFile Blackjack: Could not determine current user credits or username from the page.");
        return 0; // Default to 0 if not found
    }

    // --- Game UI Elements and Styling ---

    GM_addStyle(`
        /* Ensure html and body are set up for full viewport height */
        html, body {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden; /* Prevent outer scrollbars */
        }

        /* Main Button Styling */
        #ragsToRichesBtn {
            background-color: #333; /* Dark background */
            color: #ecf0f1; /* Light text color */
            padding: 8px 30px; /* Slimmed down padding */
            border: none;
            border-radius: 8px; /* Slightly smaller border-radius */
            font-size: 1.5em; /* Slightly smaller font for a slimmer look */
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4); /* Adjusted shadow */
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 10px auto; /* Reduced margin, centered */
            display: block;
            background-image: linear-gradient(to bottom right, #444, #222); /* Subtle gradient */
            border: 1px solid #555; /* Slightly lighter border */
        }
        #ragsToRichesBtn:hover {
            background-color: #555; /* Lighter on hover */
            transform: translateY(-1px); /* Less dramatic lift */
            box-shadow: 0 5px 12px rgba(0, 0, 0, 0.5); /* Adjusted shadow on hover */
            background-image: linear-gradient(to bottom right, #555, #333);
        }
        #ragsToRichesBtn:active {
            transform: translateY(0);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        /* Modal Backdrop */
        .blackjack-modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.85); /* Darker overlay */
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 100000; /* Ensure it's on top */
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.4s ease, visibility 0.4s ease;
        }
        .blackjack-modal-backdrop.show {
            opacity: 1;
            visibility: visible;
        }

        /* Modal Content */
        .blackjack-modal-content {
            background-color: #2c3e50; /* Fallback for if image fails, or to blend with */
            padding: 20px; /* Reduced padding slightly for more space */
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            text-align: center;
            max-width: 900px; /* Wider to provide more space */
            width: 95%;
            height: 85vh; /* Fixed height to prevent scrolling */
            overflow: hidden; /* Prevent internal scrolling */
            margin: 20px auto; /* Add margin for spacing from edges */
            transform: scale(0.9);
            transition: transform 0.4s ease;
            color: #ecf0f1; /* Light grey text */
            font-family: 'Arial', sans-serif;
            border: 3px solid #f39c12; /* Orange border */

            /* Poker table theme */
            background-image: linear-gradient(to bottom, rgba(0,0,0,0.6), rgba(0,0,0,0.8)), url('https://placehold.co/900x500/228B22/228B22'); /* Removed text, matched background color */
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            background-blend-mode: overlay; /* Blend mode can affect overall look */
            
            /* Positioning context for absolute elements */
            position: relative; /* CRITICAL for absolute positioning of children */
            display: grid; /* Use grid for main layout */
            grid-template-areas:
                "stats stats close-btn"
                "dealer-avatar . player-avatar"
                "dealer-name-score . player-name-score"
                "dealer-hand game-message player-hand" /* Hands on sides, message in center, allowing vertical stretch for cards */
                ". controls ."
                ". bottom-controls .";
            grid-template-columns: 1fr 2fr 1fr; /* Flexible columns, center is wider */
            grid-template-rows: auto 1fr auto 2fr auto auto; /* Adjusted rows for better spacing */
            gap: 5px 0; /* Reduced vertical gap */
            align-items: center; /* Vertically center content in rows by default */
            justify-content: center; /* Horizontally center grid items */
        }

        .blackjack-modal-backdrop.show {
            opacity: 1;
            visibility: visible;
        }

        .blackjack-modal-backdrop.show .blackjack-modal-content {
            transform: scale(1);
        }

        /* Stats Header Styling */
        .blackjack-stats-header {
            grid-area: stats;
            font-size: 1.3em;
            font-weight: bold;
            color: #f39c12;
            margin-bottom: 5px; /* Reduced margin */
            padding: 5px 10px; /* Reduced padding, adjusted to allow text to stretch */
            border-bottom: 1px solid rgba(255,255,255,0.2);
            text-shadow: 1px 1px 3px rgba(0,0,0,0.5);
            width: 100%; /* Occupy full width of grid area */
            text-align: center; /* Center horizontally across stats area */
            display: flex; /* Use flexbox for internal alignment of stats */
            justify-content: space-around; /* Distribute items evenly */
            align-items: center;
            flex-wrap: wrap; /* Allow wrapping on smaller screens */
        }
        .blackjack-stats-header span {
            color: #ecf0f1;
            margin: 0 8px; /* Adjusted margin for horizontal spacing */
            font-weight: normal;
            display: inline-block; /* Ensure labels and values stay together but allow wrapping */
        }
        .blackjack-stats-header .value {
            color: #2ecc71;
            font-weight: bold;
        }
        .blackjack-stats-header .value.loss {
            color: #e74c3c;
        }
        .blackjack-stats-header .value.earned {
            color: #2ecc71;
        }
        .blackjack-stats-header .value.lost {
            color: #e74c3c;
        }

        /* Close Button (X) */
        #blackjackCloseBtnX {
            grid-area: close-btn;
            background: none;
            border: none;
            color: #ecf0f1;
            font-size: 2em;
            cursor: pointer;
            padding: 5px 10px;
            position: absolute; /* Absolute positioning */
            top: 10px; /* Top right corner */
            right: 10px;
            z-index: 10; /* Ensure it's above other content */
            transition: color 0.2s ease;
        }
        #blackjackCloseBtnX:hover {
            color: #e74c3c; /* Red on hover */
        }

        /* Avatar Containers */
        .dealer-section {
            grid-area: dealer-avatar;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .player-section {
            grid-area: player-avatar;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        
        .dealer-name-score {
            grid-area: dealer-name-score;
            text-align: center;
            margin-top: -15px; /* Pull up closer to avatar */
        }
        .player-name-score {
            grid-area: player-name-score;
            text-align: center;
            margin-top: -15px; /* Pull up closer to avatar */
        }

        .avatar-container {
            width: 90px; /* Slightly smaller avatar to save space */
            height: 90px;
            border-radius: 50%;
            border: 3px solid #f39c12;
            overflow: hidden;
            margin-bottom: 5px; /* Reduced space */
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: #333; /* Fallback for avatar */
        }
        .avatar-container img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        .blackjack-modal-content h3 {
            margin-top: 0;
            margin-bottom: 5px;
            color: #f1c40f;
            font-size: 1.1em; /* Reduced hand title font size */
        }

        /* Betting Area (now hidden and managed by prompt) */
        .blackjack-betting-area {
            grid-area: betting-area; /* Assigned grid area */
            display: flex;
            justify-content: center;
            align-items: center;
            margin-top: 15px;
            margin-bottom: 25px;
            flex-wrap: wrap;
        }
        .blackjack-betting-area label {
            margin-right: 10px;
            font-size: 1.1em;
            color: #ecf0f1;
        }
        .blackjack-betting-area input[type="number"] {
            width: 100px;
            padding: 8px 12px;
            border-radius: 5px;
            border: 1px solid #7f8c8d;
            background-color: #ecf0f1;
            color: #333;
            font-size: 1em;
            text-align: center;
            -moz-appearance: textfield;
        }
        .blackjack-betting-area input[type="number"]::-webkit-outer-spin-button,
        .blackjack-betting-area input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .blackjack-betting-area button {
            background-color: #3498db;
            color: white;
            padding: 8px 15px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            font-weight: bold;
            margin-left: 15px;
            transition: background-color 0.2s ease, transform 0.1s ease;
        }
        .blackjack-betting-area button:hover {
            background-color: #2980b9;
            transform: translateY(-1px);
        }
        .blackjack-betting-area button:disabled {
            background-color: #7f8c8d;
            cursor: not-allowed;
            transform: none;
        }


        .blackjack-message {
            grid-area: game-message; /* Corrected to 'game-message' from 'message' to match grid area */
            font-size: 1.5em; /* Slightly smaller for compactness */
            font-weight: bold;
            margin: 0; /* Remove top/bottom margins */
            padding: 10px;
            border-radius: 8px;
            background-color: rgba(0,0,0,0.2);
            color: #ecf0f1;
            min-height: 1.5em;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .blackjack-message.win { color: #2ecc71; }
        .blackjack-message.lose { color: #e74c3c; }
        .blackjack-message.push { color: #3498db; }
        .blackjack-message.playing { color: #f1c40f; }
        .blackjack-message.error { color: #e74c3c; }

        /* Rags 2 Riches Title */
        #rags2RichesTitle {
            position: absolute; /* Keep absolute to layer over grid cells */
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%); /* Center perfectly */
            font-family: 'Luckiest Guy', cursive, 'Impact', 'Arial Black', sans-serif;
            font-size: 4em; /* Adjusted size to be more like a logo */
            color: rgba(255, 215, 0, 1); /* Fully opaque gold color */
            text-shadow: 3px 3px 7px rgba(0,0,0,0.8); /* Stronger shadow for definition */
            line-height: 0.8; /* Tighter line height for stacked words */
            pointer-events: none; /* Allow clicks to pass through */
            white-space: nowrap; /* Prevent wrapping if possible */
            z-index: 5; /* Ensure it's above background, below cards/avatars */
        }
        #rags2RichesTitle span {
            display: block; /* Each word on its own line */
            text-align: center;
        }

        /* Card Display */
        .blackjack-hand {
            display: flex;
            justify-content: center;
            align-items: center;
            flex-wrap: wrap;
            margin-bottom: 0; /* Remove bottom margin to save vertical space */
            min-height: 80px;
            padding: 5px 0; /* Small vertical padding */
        }
        /* Specific grid areas for hands */
        #dealerHandDiv { grid-area: dealer-hand; }
        #playerHandDiv { grid-area: player-hand; }

        .blackjack-card {
            background-color: #fefefe;
            color: #333;
            border: 2px solid #555;
            border-radius: 12px;
            padding: 5px;
            margin: 3px; /* Reduced margin */
            font-weight: bold;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            width: 70px; /* Slightly smaller card size */
            height: 100px; /* Slightly smaller card size */
            box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.3);
            text-shadow: none;
            position: relative;
            overflow: hidden;
            font-family: 'Georgia', serif;
            background-image: linear-gradient(to bottom right, #fefefe, #e0e0e0);
        }
        .blackjack-card .card-rank {
            font-size: 1.8em; /* Adjusted font size */
            line-height: 1;
            margin-top: 3px;
        }
        .blackjack-card .card-suit {
            font-size: 1.6em; /* Adjusted font size */
            line-height: 1;
            margin-bottom: 3px;
        }
        .blackjack-card .card-suit.red-suit {
            color: #e74c3c;
        }
        .blackjack-card.hidden-card {
            background-color: #3f0000;
            color: #e74c3c;
            border: 2px solid #a93226;
            font-size: 1.4em; /* Adjusted font size */
            justify-content: center;
            align-items: center;
            text-align: center;
            line-height: 1;
            display: flex;
        }

        /* Buttons (Hit, Stand, New Game) */
        .blackjack-controls {
            grid-area: controls;
            margin-top: 10px; /* Reduced margin */
            display: flex;
            justify-content: center;
            gap: 10px; /* Reduced gap between buttons */
            flex-wrap: wrap;
        }
        .blackjack-controls button {
            background-color: #444;
            color: white;
            padding: 8px 18px; /* Slightly smaller padding */
            border: 1px solid #666;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1em; /* Reduced font size */
            font-weight: bold;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.1s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-transform: uppercase;
            background-image: linear-gradient(to bottom right, #555, #333);
        }
        .blackjack-controls button:hover {
            background-color: #666;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            background-image: linear-gradient(to bottom right, #666, #444);
        }
        .blackjack-controls button:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        .blackjack-controls button:disabled {
            background-color: #7f8c8d;
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
            background-image: none;
        }

        /* Specific button overrides for colors */
        #blackjackHitBtn { background-color: #2ecc71; background-image: linear-gradient(to bottom right, #2ecc71, #27ae60); }
        #blackjackHitBtn:hover { background-color: #27ae60; background-image: linear-gradient(to bottom right, #27ae60, #229954); }

        #blackjackStandBtn { background-color: #e67e22; background-image: linear-gradient(to bottom right, #e67e22, #d35400); }
        #blackjackStandBtn:hover { background-color: #d35400; background-image: linear-gradient(to bottom right, #d35400, #bb4400); }

        #blackjackNewGameBtn { background-color: #3498db; background-image: linear-gradient(to bottom right, #3498db, #2980b9); }
        #blackjackNewGameBtn:hover { background-color: #2980b9; background-image: linear-gradient(to bottom right, #2980b9, #206da0); }

        /* Bottom Controls (Transfer) */
        .bottom-controls {
            grid-area: bottom-controls;
            display: flex;
            justify-content: center;
            margin-top: 5px; /* Reduced margin */
            gap: 15px;
            flex-wrap: wrap;
        }
        .bottom-controls button {
            background-color: #444;
            color: white;
            padding: 10px 20px;
            border: 1px solid #666;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1.1em;
            font-weight: bold;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.1s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-transform: uppercase;
            background-image: linear-gradient(to bottom right, #555, #333);
        }
        .bottom-controls button:hover {
            background-color: #666;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            background-image: linear-gradient(to bottom right, #666, #444);
        }
        .bottom-controls button:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }

        #transferCreditsBtn { background-color: #f39c12; background-image: linear-gradient(to bottom right, #f39c12, #e67e22); }
        #transferCreditsBtn:hover { background-color: #e67e22; background-image: linear-gradient(to bottom right, #e67e22, #d35400); }
    `);

    // Function to create the Blackjack game modal and its elements
    function createGameModal() {
        // Create modal backdrop
        gameModal = document.createElement('div');
        gameModal.className = 'blackjack-modal-backdrop';
        gameModal.id = 'blackjackGameModal';

        // Create modal content area
        const modalContent = document.createElement('div');
        modalContent.className = 'blackjack-modal-content';

        // Stats Header
        const statsHeaderDiv = document.createElement('div');
        statsHeaderDiv.className = 'blackjack-stats-header';
        statsHeaderDiv.innerHTML = `
            <span class="label">cr.:</span> <span class="value" id="currentCreditsDisplay">0.00</span>
            <span class="label">Wins:</span> <span class="value" id="winsDisplay">0</span>
            <span class="label">Losses:</span> <span class="value" id="lossesDisplay">0</span>
            <span class="label">Earned:</span> <span class="value earned" id="totalEarnedDisplay">0.00</span>
            <span class="label">Lost:</span> <span class="value lost" id="totalLostDisplay">0.00</span>
        `;
        currentCreditsDisplay = statsHeaderDiv.querySelector('#currentCreditsDisplay');
        winsDisplayElement = statsHeaderDiv.querySelector('#winsDisplay');
        lossesDisplayElement = statsHeaderDiv.querySelector('#lossesDisplay');
        totalEarnedDisplay = statsHeaderDiv.querySelector('#totalEarnedDisplay');
        totalLostDisplay = statsHeaderDiv.querySelector('#totalLostDisplay');

        // Close Button (X)
        closeButtonX = document.createElement('button');
        closeButtonX.id = 'blackjackCloseBtnX';
        closeButtonX.textContent = 'X';
        closeButtonX.addEventListener('click', hideGameModal);


        // Dealer's Section (Avatar, Hand)
        const dealerSection = document.createElement('div');
        dealerSection.className = 'dealer-section';

        const dealerAvatarContainer = document.createElement('div');
        dealerAvatarContainer.className = 'avatar-container';
        const dealerImage = document.createElement('img');
        dealerImage.src = DEALER_IMAGE_URL;
        dealerImage.alt = `${DEALER_NAME} dealer image`;
        dealerImage.onerror = function() {
            this.onerror = null;
            this.src = `https://placehold.co/100x100/333/ecf0f1`; // Plain placeholder, no text
            console.error(`Failed to load dealer image from ${DEALER_IMAGE_URL}. Displaying placeholder.`);
        };
        dealerAvatarContainer.appendChild(dealerImage);
        dealerSection.appendChild(dealerAvatarContainer);

        dealerHandDiv = document.createElement('div');
        dealerHandDiv.id = 'dealerHandDiv'; // Assign ID for grid area
        dealerHandDiv.className = 'blackjack-hand';
        dealerSection.appendChild(dealerHandDiv);


        // Dealer Name and Score
        const dealerNameScoreDiv = document.createElement('div');
        dealerNameScoreDiv.className = 'dealer-name-score';
        dealerNameScoreDiv.innerHTML = `<h3>${DEALER_NAME}'s Hand: <span id="dealerScore"></span></h3>`;
        dealerScoreDiv = dealerNameScoreDiv.querySelector('#dealerScore');


        // Player's Section (Avatar, Hand)
        const playerSection = document.createElement('div');
        playerSection.className = 'player-section';

        const playerAvatarContainer = document.createElement('div');
        playerAvatarContainer.className = 'avatar-container';
        const playerImage = document.createElement('img');
        playerImage.src = PLAYER_AVATAR_PLACEHOLDER_URL; // Using placeholder for player
        playerImage.alt = 'Your avatar';
        playerImage.onerror = function() {
            this.onerror = null;
            this.src = `https://placehold.co/100x100/333/ecf0f1`; // Plain placeholder, no text
            console.error(`Failed to load player image placeholder. Displaying default placeholder.`);
        };
        playerAvatarContainer.appendChild(playerImage);
        playerSection.appendChild(playerAvatarContainer);

        playerHandDiv = document.createElement('div');
        playerHandDiv.id = 'playerHandDiv'; // Assign ID for grid area
        playerHandDiv.className = 'blackjack-hand';
        playerSection.appendChild(playerHandDiv);

        // Player Name and Score
        const playerNameScoreDiv = document.createElement('div');
        playerNameScoreDiv.className = 'player-name-score';
        playerNameScoreDiv.innerHTML = `<h3>Your Hand: <span id="playerScore"></span></h3>`;
        playerScoreDiv = playerNameScoreDiv.querySelector('#playerScore');


        // Betting Area (will be placed in its own grid area)
        const bettingArea = document.createElement('div');
        bettingArea.className = 'blackjack-betting-area';
        bettingArea.style.display = 'none'; // Hide as prompt handles bet


        // Game Message
        gameMessageDiv = document.createElement('div');
        gameMessageDiv.className = 'blackjack-message playing';
        gameMessageDiv.textContent = 'Place your bet to start!';

        // Controls (Hit, Stand, New Game)
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'blackjack-controls';

        hitBtn = document.createElement('button');
        hitBtn.id = 'blackjackHitBtn';
        hitBtn.textContent = 'Hit';

        standBtn = document.createElement('button');
        standBtn.id = 'blackjackStandBtn';
        standBtn.textContent = 'Stand';

        newGameBtn = document.createElement('button');
        newGameBtn.id = 'blackjackNewGameBtn';
        newGameBtn.textContent = 'New Hand';
        newGameBtn.style.display = 'none';

        controlsDiv.appendChild(hitBtn);
        controlsDiv.appendChild(standBtn);
        controlsDiv.appendChild(newGameBtn);

        // Additional Control Buttons (Transfer Credits)
        const bottomControlsDiv = document.createElement('div');
        bottomControlsDiv.className = 'bottom-controls';

        transferCreditsBtn = document.createElement('button');
        transferCreditsBtn.id = 'transferCreditsBtn';
        transferCreditsBtn.textContent = 'Transfer Credits';

        bottomControlsDiv.appendChild(transferCreditsBtn);

        // Rags 2 Riches Title in the middle of the table
        rags2RichesTitle = document.createElement('div');
        rags2RichesTitle.id = 'rags2RichesTitle';
        rags2RichesTitle.innerHTML = '<span>RAGS</span><span>2</span><span>RICHES</span>';


        // Append all elements to modal content based on grid areas
        modalContent.appendChild(statsHeaderDiv);
        modalContent.appendChild(closeButtonX);
        modalContent.appendChild(dealerSection);
        modalContent.appendChild(dealerNameScoreDiv);
        modalContent.appendChild(playerSection);
        modalContent.appendChild(playerNameScoreDiv);
        modalContent.appendChild(bettingArea);
        modalContent.appendChild(gameMessageDiv);
        modalContent.appendChild(controlsDiv);
        modalContent.appendChild(bottomControlsDiv);
        modalContent.appendChild(rags2RichesTitle);


        // Append modal content to backdrop
        gameModal.appendChild(modalContent);

        // Append backdrop to body
        document.body.appendChild(gameModal);

        // Event listeners for buttons
        hitBtn.addEventListener('click', playerHit);
        standBtn.addEventListener('click', playerStand);
        newGameBtn.addEventListener('click', resetGame);
        transferCreditsBtn.addEventListener('click', redirectToCreditTransfer);

        // Initial UI state
        setGameControlState(false);
        updateStatsDisplay();
    }

    // --- Game Flow Functions ---

    // Updates the win/loss/total earned/lost display
    function updateStatsDisplay() {
        if (currentCreditsDisplay) currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);
        if (winsDisplayElement) winsDisplayElement.textContent = wins;
        if (lossesDisplayElement) lossesDisplayElement.textContent = losses;
        if (totalEarnedDisplay) totalEarnedDisplay.textContent = totalEarned.toFixed(2);
        if (totalLostDisplay) totalLostDisplay.textContent = totalLost.toFixed(2);
    }

    // Sets the state of game control buttons (hit, stand)
    function setGameControlState(enabled) {
        hitBtn.disabled = !enabled;
        standBtn.disabled = !enabled;
    }

    // Resets the game state and UI for a new hand (not resetting overall stats)
    async function resetGame() {
        // Clear any existing bet timeout
        if (betTimeoutId) {
            clearTimeout(betTimeoutId);
            betTimeoutId = null;
        }

        createDeck();
        playerHand = [];
        dealerHand = [];
        gameOver = false;
        currentBet = 0;

        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);

        gameMessageDiv.textContent = 'Place your bet for the next hand!';
        gameMessageDiv.className = 'blackjack-message playing';

        dealerHandDiv.innerHTML = '';
        dealerScoreDiv.textContent = '';
        playerHandDiv.innerHTML = '';
        playerScoreDiv.textContent = '';

        hitBtn.style.display = '';
        standBtn.style.display = '';
        newGameBtn.style.display = 'none';
        setGameControlState(false);

        // Prompt for bet (moved after modal is open)
        await promptForBet();
    }

    // Prompts the user for a bet amount with a timeout
    async function promptForBet() {
        gameMessageDiv.textContent = `Enter your bet (You have ${currentUsersCredits.toFixed(2)} credits). You have ${BET_TIMEOUT_MS / 1000} seconds.`;
        gameMessageDiv.classList.remove('error');

        return new Promise(resolve => {
            const timerStart = Date.now();
            let betAmount = 0;

            // Immediately set a timeout for the prompt
            betTimeoutId = setTimeout(() => {
                // If the promise hasn't been resolved by user input, the timeout has expired
                if (!gameOver) { // Ensure game hasn't ended already
                    gameMessageDiv.textContent = "Time's up! Bet defaulted to 0.";
                    gameMessageDiv.classList.add('error');
                    resolve(0);
                }
            }, BET_TIMEOUT_MS); // Timeout for the prompt itself

            let input = prompt(`Enter your bet (You have ${currentUsersCredits.toFixed(2)} credits).`);

            // Clear the timeout as soon as the user provides input or cancels
            clearTimeout(betTimeoutId);

            if (input === null) { // User cancelled prompt
                gameMessageDiv.textContent = "Bet cancelled. Bet defaulted to 0.";
                gameMessageDiv.classList.add('error');
                betAmount = 0;
                resolve(betAmount);
                return;
            }

            let parsedBet = parseFloat(input);

            if (isNaN(parsedBet) || parsedBet <= 0) {
                gameMessageDiv.textContent = 'Invalid bet. Must be a positive number. Starting with 0 bet.';
                gameMessageDiv.classList.add('error');
                betAmount = 0;
            } else if (parsedBet > currentUsersCredits) {
                gameMessageDiv.textContent = `Not enough credits. You have ${currentUsersCredits.toFixed(2)} cr. Starting with 0 bet.`;
                gameMessageDiv.classList.add('error');
                betAmount = 0;
            } else {
                betAmount = parsedBet;
            }
            resolve(betAmount);
        }).then(bet => {
            if (bet > 0) {
                currentBet = bet;
                currentUsersCredits -= currentBet; // Deduct bet from displayed credits
                currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);
                gameMessageDiv.textContent = `Bet of ${currentBet.toFixed(2)} placed. Dealing cards...`;
                gameMessageDiv.className = 'blackjack-message playing';
                startGameRound();
            } else {
                gameMessageDiv.textContent = "No valid bet placed. Start a new hand to try again.";
                gameMessageDiv.className = 'blackjack-message error';
                newGameBtn.style.display = ''; // Show New Hand button
            }
        });
    }


    // Starts a new game round after a bet is placed
    function startGameRound() {
        createDeck();
        playerHand = [];
        dealerHand = [];
        gameOver = false;

        // Deal initial cards
        playerHand.push(dealCard());
        dealerHand.push(dealCard()); // Dealer's first card
        playerHand.push(dealCard());
        dealerHand.push(dealCard()); // Dealer's second card (one will be hidden)

        updateUI();
        setGameControlState(true); // Enable game controls

        // Check for immediate blackjack
        if (getHandValue(playerHand) === 21) {
            gameMessageDiv.textContent = `BLACKJACK! You win! Payout: ${(currentBet * BLACKJACK_PAYOUT_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            endGame(currentBet * BLACKJACK_PAYOUT_MULTIPLIER); // Pass payout for transfer
        }
    }

    // Updates the display of hands and scores
    function updateUI(showDealerFullHand = false) {
        // Player Hand
        playerHandDiv.innerHTML = playerHand.map(card => `<div class="blackjack-card">${getCardDisplay(card)}</div>`).join('');
        playerScoreDiv.textContent = getHandValue(playerHand);

        // Dealer Hand
        dealerHandDiv.innerHTML = '';
        if (showDealerFullHand) {
            dealerHandDiv.innerHTML = dealerHand.map(card => `<div class="blackjack-card">${getCardDisplay(card)}</div>`).join('');
            dealerScoreDiv.textContent = getHandValue(dealerHand);
        } else {
            // Show only first card, second card as hidden
            dealerHandDiv.innerHTML = `<div class="blackjack-card">${getCardDisplay(dealerHand[0])}</div><div class="blackjack-card hidden-card">?</div>`;
            dealerScoreDiv.textContent = getHandValue([dealerHand[0]]); // Show score of only the visible card
        }
    }

    // Player action: Hit
    function playerHit() {
        if (gameOver) return;

        playerHand.push(dealCard());
        updateUI();

        if (getHandValue(playerHand) > 21) {
            gameMessageDiv.textContent = `Bust! You lose. Your bet of ${currentBet.toFixed(2)} credits will be sent to ${DEALER_NAME}.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('lose');
            endGame(-currentBet); // Pass negative bet for loss
        }
    }

    // Player action: Stand
    function playerStand() {
        if (gameOver) return;

        setGameControlState(false); // Disable player controls
        gameOver = true; // Set game over immediately

        // Dealer's turn
        updateUI(true); // Show dealer's hidden card
        dealerTurn();
    }

    // Dealer's turn logic
    function dealerTurn() {
        let dealerScore = getHandValue(dealerHand);
        while (dealerScore < 17) {
            dealerHand.push(dealCard());
            dealerScore = getHandValue(dealerHand);
            updateUI(true); // Update dealer's hand
            // Add a small delay for visual effect for a real game, but for script, just update quickly
        }
        determineWinner();
    }

    // Determines the winner of the game and calculates credit change
    function determineWinner() {
        const playerScore = getHandValue(playerHand);
        const dealerScore = getHandValue(dealerHand);
        let creditChange = 0; // The amount of credits to be transferred (can be negative for loss)

        updateUI(true); // Ensure dealer's hand is fully visible

        if (playerScore > 21) {
            // Already handled by playerHit for bust
            gameMessageDiv.textContent = `Bust! You lose. Your bet of ${currentBet.toFixed(2)} credits will be sent to ${DEALER_NAME}.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('lose');
            creditChange = -currentBet;
            losses++; // Increment loss count
            totalLost += currentBet; // Add to total lost
        } else if (dealerScore > 21) {
            gameMessageDiv.textContent = `Dealer busts! You win! Payout: ${(currentBet * REGULAR_WIN_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            creditChange = currentBet * REGULAR_WIN_MULTIPLIER;
            wins++; // Increment win count
            totalEarned += creditChange; // Add to total earned
        } else if (playerScore > dealerScore) {
            gameMessageDiv.textContent = `You win! Payout: ${(currentBet * REGULAR_WIN_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            creditChange = currentBet * REGULAR_WIN_MULTIPLIER;
            wins++; // Increment win count
            totalEarned += creditChange; // Add to total earned
        } else if (dealerScore > playerScore) {
            gameMessageDiv.textContent = `Dealer wins! You lose. Your bet of ${currentBet.toFixed(2)} credits will be sent to ${DEALER_NAME}.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('lose');
            creditChange = -currentBet;
            losses++; // Increment loss count
            totalLost += currentBet; // Add to total lost
        } else {
            gameMessageDiv.textContent = `Push! It's a tie. Your bet of ${currentBet.toFixed(2)} credits is returned.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('push');
            creditChange = 0; // Bet is returned on push
        }
        endGame(creditChange);
    }

    // Ends the current game round and prepares credit transfer
    function endGame(creditChange) {
        gameOver = true;
        setGameControlState(false); // Disable game buttons
        newGameBtn.style.display = ''; // Show New Game button

        // Update displayed credits (add win or subtract loss from previous deduction)
        currentUsersCredits += creditChange;
        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);
        updateStatsDisplay(); // Update win/loss and total earned/lost display

        // Prepare for manual credit transfer via mycredits.php
        if (creditChange !== 0) {
            const transferAmount = Math.abs(creditChange);
            const transferRecipient = creditChange > 0 ? actualUsersUsername : DEALER_NAME;
            const transferReason = creditChange > 0 ? `Blackjack Win: +${transferAmount.toFixed(2)}` : `Blackjack Loss: -${transferAmount.toFixed(2)}`;

            GM_setValue(STORAGE_KEY_PENDING_CREDIT, true);
            GM_setValue(STORAGE_KEY_RECIPIENT, transferRecipient);
            GM_setValue(STORAGE_KEY_AMOUNT, transferAmount);
            GM_setValue(STORAGE_KEY_REASON, transferReason);

            // Update message to include transfer instructions without an alert
            gameMessageDiv.innerHTML += `<br>Credits need to be transferred. Click "Transfer Credits" to finalize on MyCredits page.`;
        }
    }

    // --- Modal Visibility Functions ---

    // Shows the game modal and reads user credits
    async function showGameModal() {
        if (!gameModal) {
            createGameModal(); // Create elements if they don't exist
            // Load Google Font for Rags 2 Riches title
            const link = document.createElement('link');
            link.href = 'https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=swap';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        readUserCreditsFromPage(); // Read credits from the actual page
        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2); // Update initial display

        gameModal.classList.add('show');
        // Now prompt for bet after the modal is shown
        await resetGame(); // This now includes the promptForBet call
    }

    // Hides the game modal
    function hideGameModal() {
        if (gameModal) {
            gameModal.classList.remove('show');
            // Allow time for transition before hiding completely
            setTimeout(() => {
                gameModal.style.visibility = 'hidden';
            }, 400);
        }
    }

    // Handles redirecting to mycredits.php for manual transfer
    function redirectToCreditTransfer() {
        const pendingCredit = GM_getValue(STORAGE_KEY_PENDING_CREDIT, false);
        if (pendingCredit) {
            // IMPORTANT: Using confirm() as per previous interactions for a modal-like prompt.
            // If you prefer a custom in-game message instead of a browser confirm, let me know.
            if (confirm("You have a pending credit transfer. Click OK to go to the MyCredits page to finalize it, or Cancel to stay here.")) {
                 window.location.href = 'https://www.funfile.org/mycredits.php';
            }
        } else {
            alert("No pending credit transfer. Play a hand to win or lose credits!");
        }
    }

    // --- Initialize "Rags To Riches" button ---
    function initializeRagsToRichesButton() {
        const headBanner = document.querySelector('.head_banner'); // Select the banner div directly
        if (headBanner) {
            const ragsToRichesBtn = document.createElement('button');
            ragsToRichesBtn.id = 'ragsToRichesBtn';
            ragsToRichesBtn.textContent = 'Rags2Riches'; // Button text
            ragsToRichesBtn.addEventListener('click', showGameModal);

            // Insert the button directly after the head_banner div
            // The .head_banner div is a direct child of .maincontent or .main_wrapper
            // so we need to insert it after the head_banner itself.
            headBanner.parentNode.insertBefore(ragsToRichesBtn, headBanner.nextSibling);
        } else {
            // Fallback if .head_banner not found (less likely on FunFile)
            document.body.prepend(ragsToRichesBtn);
            console.warn("FunFile Blackjack: Could not find .head_banner. Placing Rags2Riches button at body start.");
        }
    }

    // --- Handle Credit Pre-filling on mycredits.php ---
    function handlePendingCreditTransfer() {
        if (window.location.href.includes('https://www.funfile.org/mycredits.php')) {
            const pendingCredit = GM_getValue(STORAGE_KEY_PENDING_CREDIT, false);

            if (pendingCredit) {
                const recipient = GM_getValue(STORAGE_KEY_RECIPIENT, '');
                const amount = GM_getValue(STORAGE_KEY_AMOUNT, 0);
                const reason = GM_getValue(STORAGE_KEY_REASON, '');

                const commerceUserField = document.querySelector('input[name="commerce2user"]');
                const user2userReasonField = document.querySelector('input[name="user2user_reason"]');
                const user2userAmountField = document.querySelector('input[name="user2user"]');

                if (commerceUserField && user2userReasonField && user2userAmountField) {
                    commerceUserField.value = recipient;
                    user2userReasonField.value = reason;
                    user2userAmountField.value = amount.toFixed(2); // Ensure consistent decimal format

                    // IMPORTANT: Using alert() here to notify the user about pre-filling.
                    // This is for out-of-game context on the mycredits.php page.
                    alert(`Blackjack Credit Transfer Ready!\n\nThe credit exchange form has been pre-filled for:\nRecipient: ${recipient}\nAmount: ${amount.toFixed(2)} cr.\nReason: "${reason}"\n\nPlease review the details and click the "Send Credits" button to complete the transaction.`);

                    // Clear the storage flags so it doesn't pre-fill again on refresh
                    GM_deleteValue(STORAGE_KEY_PENDING_CREDIT);
                    GM_deleteValue(STORAGE_KEY_RECIPIENT);
                    GM_deleteValue(STORAGE_KEY_AMOUNT);
                    GM_deleteValue(STORAGE_KEY_REASON);
                } else {
                    console.error('FunFile Blackjack: Could not find all credit exchange form fields on mycredits.php. Is the page structure correct?');
                    // Even if fields not found, clear flags to avoid persistent errors.
                    GM_deleteValue(STORAGE_KEY_PENDING_CREDIT);
                    GM_deleteValue(STORAGE_KEY_RECIPIENT);
                    GM_deleteValue(STORAGE_KEY_AMOUNT);
                    GM_deleteValue(STORAGE_KEY_REASON);
                    alert("Blackjack credit transfer could not be set up automatically. Please check the console for errors and transfer credits manually if needed.");
                }
            }
        }
    }


    // --- Run Initialization ---
    // Handle pending credit transfer as soon as mycredits.php loads
    handlePendingCreditTransfer();
    // Initialize the Rags2Riches button once the main page is loaded
    window.addEventListener('load', initializeRagsToRichesButton);

})();
