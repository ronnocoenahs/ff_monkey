// ==UserScript==
// @name         FunFile Rags To Riches Blackjack
// @namespace    http://tampermonkey.net/
// @version      0.9 // Increased version for endless hands and win/loss tracking
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
    // These multipliers are for display and calculation within the game.
    // Actual transfers are done manually via mycredits.php.
    const BLACKJACK_PAYOUT_MULTIPLIER = 1.5; // Blackjack typically pays 3:2 (1.5x bet)
    const REGULAR_WIN_MULTIPLIER = 1;       // Regular win pays 1:1 (1x bet)

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

    // --- UI Elements (will be populated once the DOM is ready) ---
    let gameModal, dealerHandDiv, dealerScoreDiv, playerHandDiv, playerScoreDiv, gameMessageDiv, hitBtn, standBtn, newGameBtn;
    let currentCreditsDisplay, betInput, placeBetBtn, winsLossesDisplay, transferCreditsBtn;

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
        return `${card.rank}${card.suit}`;
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
        /* Main Button Styling */
        #ragsToRichesBtn {
            background-color: #333; /* Dark background */
            color: #ecf0f1; /* Light text color */
            padding: 15px 30px;
            border: none;
            border-radius: 10px;
            font-size: 1.8em;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.5); /* Stronger shadow */
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 20px auto; /* Center button */
            display: block;
            background-image: linear-gradient(to bottom right, #444, #222); /* Subtle gradient */
            border: 2px solid #555; /* Slightly lighter border */
        }
        #ragsToRichesBtn:hover {
            background-color: #555; /* Lighter on hover */
            transform: translateY(-2px);
            box-shadow: 0 7px 20px rgba(0, 0, 0, 0.6); /* More prominent shadow on hover */
            background-image: linear-gradient(to bottom right, #555, #333);
        }
        #ragsToRichesBtn:active {
            transform: translateY(0);
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
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
            max-width: 850px; /* Wider */
            width: 95%;
            max-height: 90vh; /* Limit height to 90% of viewport height */
            overflow-y: auto; /* Enable vertical scrolling if content exceeds max-height */
            margin: 20px auto; /* Add margin for spacing from edges */
            transform: scale(0.9);
            transition: transform 0.4s ease;
            color: #ecf0f1; /* Light grey text */
            font-family: 'Arial', sans-serif;
            border: 3px solid #f39c12; /* Orange border */

            /* Poker table theme */
            background-image: linear-gradient(to bottom, rgba(0,0,0,0.6), rgba(0,0,0,0.8)), url('https://placehold.co/850x450/228B22/FFFFFF/png?text=Poker+Table+Felt'); /* Darker gradient on top of image */
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            background-blend-mode: overlay; /* Blend mode can affect overall look */
            display: flex; /* Use flexbox for internal layout */
            flex-direction: column; /* Stack children vertically */
            justify-content: space-between; /* Distribute space */
        }
        .blackjack-modal-backdrop.show .blackjack-modal-content {
            transform: scale(1);
        }

        /* Titles and Text */
        .blackjack-modal-content h2 {
            margin-top: 0;
            color: #f39c12; /* Orange title */
            font-size: 2.2em;
            margin-bottom: 25px;
            text-shadow: 2px 2px 5px rgba(0,0,0,0.3);
        }
        .blackjack-modal-content h3 {
            margin-top: 15px; /* Adjust margin for headers */
            margin-bottom: 10px;
            color: #f1c40f; /* Sunflower yellow for hand titles */
        }
        .blackjack-info {
            font-size: 1.1em;
            color: #bdc3c7; /* Light grey for info text */
            margin-bottom: 15px;
        }
        .blackjack-info span {
            font-weight: bold;
            color: #f39c12; /* Orange for values */
        }

        /* Betting Area */
        .blackjack-betting-area {
            display: flex;
            justify-content: center;
            align-items: center;
            margin-top: 15px;
            margin-bottom: 25px;
            flex-wrap: wrap; /* Allow wrapping on smaller screens */
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
            -moz-appearance: textfield; /* Hide arrows for Firefox */
        }
        .blackjack-betting-area input[type="number"]::-webkit-outer-spin-button,
        .blackjack-betting-area input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none; /* Hide arrows for Chrome, Safari, Edge */
            margin: 0;
        }
        .blackjack-betting-area button {
            background-color: #3498db; /* Blue for Place Bet */
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
            font-size: 1.6em;
            font-weight: bold;
            margin-top: 25px;
            margin-bottom: 25px;
            padding: 10px;
            border-radius: 8px;
            background-color: rgba(0,0,0,0.2);
            color: #ecf0f1;
            min-height: 1.5em; /* Prevent layout shift */
        }
        .blackjack-message.win { color: #2ecc71; /* Emerald Green */ }
        .blackjack-message.lose { color: #e74c3c; /* Alizarin Red */ }
        .blackjack-message.push { color: #3498db; /* Peter River Blue */ }
        .blackjack-message.playing { color: #f1c40f; /* Sunflower Yellow */ }
        .blackjack-message.error { color: #e74c3c; }


        /* Dealer Image Styling */
        #dealerImage {
            width: 100px; /* Set desired size */
            height: 100px;
            border-radius: 50%; /* Make it circular */
            object-fit: cover; /* Ensure image covers the area without distortion */
            border: 3px solid #f39c12; /* Matches modal border color */
            margin-bottom: 15px; /* Spacing below image */
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4); /* Soft shadow for depth */
            display: block; /* Ensures it takes up its own line */
            margin-left: auto; /* Center the image */
            margin-right: auto; /* Center the image */
        }

        /* Card Display */
        .blackjack-hand {
            display: flex;
            justify-content: center;
            align-items: center;
            flex-wrap: wrap;
            margin-bottom: 20px;
            min-height: 80px; /* Ensure space even with few cards */
        }
        .blackjack-card {
            background-color: #fefefe; /* White card face */
            color: #333;
            border: 1px solid #7f8c8d; /* Grey border */
            border-radius: 8px;
            padding: 10px 15px;
            margin: 5px;
            font-size: 2.5em; /* Large card text */
            font-weight: bold;
            display: inline-flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            width: 80px; /* Fixed width */
            height: 120px; /* Fixed height */
            box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.3);
            text-shadow: none; /* Remove text shadow for cards */
            position: relative;
            overflow: hidden; /* For potential future card effects */
        }
        .blackjack-card.hidden-card {
            background-color: #c0392b; /* Dark red for hidden card back */
            color: #e74c3c; /* Red text */
            border: 1px solid #a93226;
            font-size: 1.5em;
            justify-content: center;
            align-items: center;
            text-align: center;
            line-height: 1;
            display: flex;
        }

        /* Buttons (Hit, Stand, New Game, Close) */
        .blackjack-controls {
            margin-top: 20px; /* Spacing above buttons */
        }
        .blackjack-controls button {
            background-color: #2ecc71; /* Emerald Green */
            color: white;
            padding: 12px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1.2em;
            font-weight: bold;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.1s ease;
            margin: 0 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-transform: uppercase;
        }
        .blackjack-controls button:hover {
            background-color: #27ae60;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }
        .blackjack-controls button:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        .blackjack-controls button:disabled {
            background-color: #7f8c8d; /* Greyed out when disabled */
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
        }

        #blackjackStandBtn { background-color: #e67e22; /* Carrot Orange */ }
        #blackjackStandBtn:hover { background-color: #d35400; }
        #blackjackNewGameBtn { background-color: #3498db; /* Peter River Blue */ }
        #blackjackNewGameBtn:hover { background-color: #2980b9; }
        #blackjackCloseBtn {
            background-color: #e74c3c; /* Alizarin Red */
            margin-top: 20px;
        }
        #blackjackCloseBtn:hover { background-color: #c0392b; }
        #transferCreditsBtn { /* New button style */
            background-color: #f39c12; /* Orange for transfer */
            color: white;
            padding: 12px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1.2em;
            font-weight: bold;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.1s ease;
            margin: 0 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-transform: uppercase;
        }
        #transferCreditsBtn:hover {
            background-color: #e67e22;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }
        #transferCreditsBtn:active {
            transform: translateY(0);
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
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

        // Title
        const title = document.createElement('h2');
        title.textContent = 'Blackjack: Rags To Riches';

        // User Info (Credits and Win/Loss display)
        const userInfoDiv = document.createElement('div');
        userInfoDiv.className = 'blackjack-info';
        userInfoDiv.innerHTML = `Your Credits: <span id="currentCreditsDisplay">0.00</span> cr. | Wins: <span id="winsLossesDisplay">0</span> | Losses: <span id="lossesDisplay">0</span>`;
        currentCreditsDisplay = userInfoDiv.querySelector('#currentCreditsDisplay');
        winsLossesDisplay = userInfoDiv.querySelector('#winsLossesDisplay'); // Added for wins
        const lossesDisplay = userInfoDiv.querySelector('#lossesDisplay'); // Added for losses

        // Betting Area
        const bettingArea = document.createElement('div');
        bettingArea.className = 'blackjack-betting-area';
        const betLabel = document.createElement('label');
        betLabel.textContent = 'Bet:';
        betInput = document.createElement('input');
        betInput.type = 'number';
        betInput.id = 'betInput';
        betInput.min = '1';
        betInput.value = '10'; // Default bet
        betInput.step = '1'; // Allow integer bets
        placeBetBtn = document.createElement('button');
        placeBetBtn.id = 'placeBetBtn';
        placeBetBtn.textContent = 'Place Bet';
        bettingArea.appendChild(betLabel);
        bettingArea.appendChild(betInput);
        bettingArea.appendChild(placeBetBtn);


        // Dealer's Area
        const dealerArea = document.createElement('div');
        dealerArea.innerHTML = `<h3>${DEALER_NAME}'s Hand: <span id="dealerScore"></span></h3>`;

        const dealerImage = document.createElement('img'); // Create image element
        dealerImage.id = 'dealerImage';
        dealerImage.src = DEALER_IMAGE_URL;
        dealerImage.alt = `${DEALER_NAME} dealer image`;
        // Fallback for image loading errors:
        dealerImage.onerror = function() {
            this.onerror = null; // Prevent infinite loop
            this.src = `https://placehold.co/100x100/333/ecf0f1?text=${DEALER_NAME.substring(0,1)}`; // Placeholder with initial
            console.error(`Failed to load dealer image from ${DEALER_IMAGE_URL}. Displaying placeholder.`);
        };
        dealerArea.appendChild(dealerImage); // Append image to dealer area

        dealerHandDiv = document.createElement('div');
        dealerHandDiv.className = 'blackjack-hand';
        dealerArea.appendChild(dealerHandDiv);
        dealerScoreDiv = dealerArea.querySelector('#dealerScore');


        // Player's Area
        const playerArea = document.createElement('div');
        playerArea.innerHTML = `<h3>Your Hand: <span id="playerScore"></span></h3>`;
        playerHandDiv = document.createElement('div');
        playerHandDiv.className = 'blackjack-hand';
        playerArea.appendChild(playerHandDiv);
        playerScoreDiv = playerArea.querySelector('#playerScore');

        // Game Message
        gameMessageDiv = document.createElement('div');
        gameMessageDiv.className = 'blackjack-message playing';
        gameMessageDiv.textContent = 'Place your bet to start!';

        // Controls (Hit, Stand, New Game, Close)
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
        newGameBtn.textContent = 'New Hand'; // Changed text to "New Hand"
        newGameBtn.style.display = 'none'; // Hidden initially

        controlsDiv.appendChild(hitBtn);
        controlsDiv.appendChild(standBtn);
        controlsDiv.appendChild(newGameBtn);

        // Additional Control Buttons (Transfer Credits, Close Game)
        const bottomControlsDiv = document.createElement('div');
        bottomControlsDiv.className = 'blackjack-controls'; // Reusing class for consistent styling
        bottomControlsDiv.style.marginTop = '20px'; // Add some space

        transferCreditsBtn = document.createElement('button');
        transferCreditsBtn.id = 'transferCreditsBtn';
        transferCreditsBtn.textContent = 'Transfer Credits';

        const closeBtn = document.createElement('button');
        closeBtn.id = 'blackjackCloseBtn';
        closeBtn.textContent = 'Close Game';

        bottomControlsDiv.appendChild(transferCreditsBtn);
        bottomControlsDiv.appendChild(closeBtn);


        // Append all elements to modal content
        modalContent.appendChild(title);
        modalContent.appendChild(userInfoDiv); // Credits and Win/Loss display
        modalContent.appendChild(bettingArea); // Betting input and button
        modalContent.appendChild(dealerArea);
        modalContent.appendChild(playerArea);
        modalContent.appendChild(gameMessageDiv);
        modalContent.appendChild(controlsDiv);
        modalContent.appendChild(bottomControlsDiv); // Append the new div for bottom controls

        // Append modal content to backdrop
        gameModal.appendChild(modalContent);

        // Append backdrop to body
        document.body.appendChild(gameModal);

        // Event listeners for buttons
        hitBtn.addEventListener('click', playerHit);
        standBtn.addEventListener('click', playerStand);
        newGameBtn.addEventListener('click', resetGame); // New game button now calls reset
        placeBetBtn.addEventListener('click', placeBet);
        transferCreditsBtn.addEventListener('click', redirectToCreditTransfer); // New listener for transfer button
        closeBtn.addEventListener('click', hideGameModal);

        // Initial UI state
        setGameControlState(false); // Game controls disabled until bet is placed
        updateStatsDisplay(); // Update initial win/loss display
    }

    // --- Game Flow Functions ---

    // Updates the win/loss display
    function updateStatsDisplay() {
        winsLossesDisplay.textContent = wins;
        const lossesDisplayElement = document.querySelector('#lossesDisplay');
        if (lossesDisplayElement) {
            lossesDisplayElement.textContent = losses;
        }
    }

    // Sets the state of game control buttons (hit, stand)
    function setGameControlState(enabled) {
        hitBtn.disabled = !enabled;
        standBtn.disabled = !enabled;
    }

    // Resets the game state and UI for a new hand (not resetting scores)
    function resetGame() {
        createDeck();
        playerHand = [];
        dealerHand = [];
        gameOver = false;
        currentBet = 0; // Reset bet

        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2); // Refresh displayed credits
        betInput.value = '10'; // Reset default bet
        betInput.disabled = false;
        placeBetBtn.disabled = false;
        placeBetBtn.style.display = ''; // Show place bet button

        gameMessageDiv.textContent = 'Place your bet for the next hand!';
        gameMessageDiv.className = 'blackjack-message playing';

        dealerHandDiv.innerHTML = ''; // Clear hands
        dealerScoreDiv.textContent = '';
        playerHandDiv.innerHTML = '';
        playerScoreDiv.textContent = '';

        hitBtn.style.display = ''; // Show Hit button
        standBtn.style.display = ''; // Show Stand button
        newGameBtn.style.display = 'none'; // Hide New Game button
        setGameControlState(false); // Disable game controls until new bet
    }

    // Handles placing a bet
    function placeBet() {
        const betAmount = parseFloat(betInput.value);

        if (isNaN(betAmount) || betAmount <= 0) {
            gameMessageDiv.textContent = 'Please enter a valid bet amount (must be a positive number).';
            gameMessageDiv.className = 'blackjack-message error';
            return;
        }

        if (betAmount > currentUsersCredits) {
            gameMessageDiv.textContent = `You don't have enough credits! You have ${currentUsersCredits.toFixed(2)} cr.`;
            gameMessageDiv.className = 'blackjack-message error';
            return;
        }

        currentBet = betAmount;
        currentUsersCredits -= currentBet; // Deduct bet from displayed credits
        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2);
        gameMessageDiv.textContent = `Bet of ${currentBet} placed. Dealing cards...`;
        gameMessageDiv.className = 'blackjack-message playing';

        betInput.disabled = true; // Disable betting controls
        placeBetBtn.disabled = true;
        placeBetBtn.style.display = 'none'; // Hide place bet button

        startGameRound(); // Start the actual game round after bet
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
            gameMessageDiv.textContent = `Bust! You lose. Your bet of ${currentBet} credits will be sent to ${DEALER_NAME}.`;
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
        } else if (dealerScore > 21) {
            gameMessageDiv.textContent = `Dealer busts! You win! Payout: ${(currentBet * REGULAR_WIN_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            creditChange = currentBet * REGULAR_WIN_MULTIPLIER;
            wins++; // Increment win count
        } else if (playerScore > dealerScore) {
            gameMessageDiv.textContent = `You win! Payout: ${(currentBet * REGULAR_WIN_MULTIPLIER).toFixed(2)} credits.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('win');
            creditChange = currentBet * REGULAR_WIN_MULTIPLIER;
            wins++; // Increment win count
        } else if (dealerScore > playerScore) {
            gameMessageDiv.textContent = `Dealer wins! You lose. Your bet of ${currentBet.toFixed(2)} credits will be sent to ${DEALER_NAME}.`;
            gameMessageDiv.classList.remove('playing');
            gameMessageDiv.classList.add('lose');
            creditChange = -currentBet;
            losses++; // Increment loss count
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
        updateStatsDisplay(); // Update win/loss display

        // Prepare for manual credit transfer via mycredits.php
        if (creditChange !== 0) {
            const transferAmount = Math.abs(creditChange);
            const transferRecipient = creditChange > 0 ? actualUsersUsername : DEALER_NAME;
            const transferReason = creditChange > 0 ? `Blackjack Win: +${creditChange.toFixed(2)}` : `Blackjack Loss: -${Math.abs(creditChange).toFixed(2)}`;

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
    function showGameModal() {
        if (!gameModal) {
            createGameModal(); // Create elements if they don't exist
        }
        readUserCreditsFromPage(); // Read credits from the actual page
        currentCreditsDisplay.textContent = currentUsersCredits.toFixed(2); // Update initial display

        gameModal.classList.add('show');
        resetGame(); // Reset game state for a new round (waiting for bet)
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
            // Confirm with the user before navigating away
            if (confirm("You have a pending credit transfer. Click OK to go to the MyCredits page to finalize it, or Cancel to stay here.")) {
                 window.location.href = 'https://www.funfile.org/mycredits.php';
            }
        } else {
            alert("No pending credit transfer. Play a hand to win or lose credits!");
        }
    }

    // --- Initialize "Rags To Riches" button ---
    function initializeRagsToRichesButton() {
        const mainWrapper = document.querySelector('.main_wrapper');
        if (mainWrapper) {
            const ragsToRichesBtn = document.createElement('button');
            ragsToRichesBtn.id = 'ragsToRichesBtn';
            ragsToRichesBtn.textContent = 'Rags2Riches'; // Button text
            ragsToRichesBtn.addEventListener('click', showGameModal);

            // Insert the button prominently, e.g., before the main content area
            const headBanner = document.querySelector('.head_banner');
            if (headBanner) {
                // Insert after the current user info div inside head_banner
                const userInfoDiv = headBanner.querySelector('div[style*="float: left; margin: 5px 0 0 14px;"]');
                if (userInfoDiv) {
                    userInfoDiv.parentNode.insertBefore(ragsToRichesBtn, userInfoDiv.nextSibling);
                } else {
                    headBanner.appendChild(ragsToRichesBtn); // Fallback
                }
            } else {
                document.body.prepend(ragsToRichesBtn); // Ultimate fallback
            }
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
