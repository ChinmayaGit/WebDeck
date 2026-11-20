(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let currentCountry = 'IN';
  let currentTab = 'cards'; // 'cards' | 'insurance'
  let currentSubFilter = 'all';
  let searchQuery = '';
  const selectedForCompare = new Set();

  const DATA = {
    IN: {
      cards: [
        {
          id: 'hdfc-infinia',
          name: 'HDFC Infinia Metal Edition',
          bank: 'HDFC Bank',
          type: 'Super Premium / Travel',
          annualFee: '₹12,500 + GST (Waived on ₹10L spend)',
          rewardRate: 'Up to 33.3% on SmartBuy flights & hotels',
          lounge: 'Unlimited Domestic & International (Priority Pass + Add-ons)',
          forex: '2.0% markup (Effective +1.3% net reward)',
          highlights: ['5X Reward Points on SmartBuy', '1:1 Point Transfer to Air India, Krisflyer, ITC', 'Complimentary Club Marriott membership'],
          bestFor: 'High spenders, luxury travel & flights'
        },
        {
          id: 'sbi-cashback',
          name: 'SBI Cashback Card',
          bank: 'State Bank of India',
          type: 'Cashback',
          annualFee: '₹999 + GST (Waived on ₹2L spend)',
          rewardRate: '5% flat cashback on all online spends',
          lounge: 'None (Pure Cashback card)',
          forex: '3.5% markup',
          highlights: ['5% Cashback on Amazon, Flipkart, Myntra, Swiggy, Zomato', '1% on offline purchases', 'Cashback auto-credited to statement'],
          bestFor: 'Everyday online shopping and food delivery'
        },
        {
          id: 'axis-airtel',
          name: 'Airtel Axis Bank Credit Card',
          bank: 'Axis Bank',
          type: 'Utilities & Bills',
          annualFee: '₹500 + GST (Waived on ₹2L spend)',
          rewardRate: '25% on Airtel bills, 10% on Swiggy/Zomato/BigBasket',
          lounge: '4 Domestic Lounge visits per year',
          forex: '3.5% markup',
          highlights: ['25% Cashback on Airtel Mobile, DTH, Fiber', '10% on Utility Bills via Airtel Thanks App', '10% on Swiggy, Zomato, BigBasket'],
          bestFor: 'Monthly electricity, wifi, mobile bills & groceries'
        },
        {
          id: 'scapia',
          name: 'Scapia Federal Bank Card',
          bank: 'Federal Bank',
          type: 'Travel & Forex',
          annualFee: 'Lifetime Free (₹0)',
          rewardRate: '10% - 20% Scapia coins on travel',
          lounge: 'Unlimited domestic lounge on ₹5k monthly spend',
          forex: 'Zero Forex Markup (0%)',
          highlights: ['Zero Forex Markup worldwide', 'Lifetime Free card', 'Instant digital onboarding via app'],
          bestFor: 'International travel & foreign currency purchases'
        }
      ],
      insurance: [
        {
          id: 'hdfc-ergo-optima',
          name: 'HDFC ERGO Optima Secure',
          company: 'HDFC ERGO',
          type: 'Health Insurance',
          csr: '98.6% Claim Settlement Ratio',
          sumInsured: '₹5 Lakhs to ₹2 Crores',
          waitingPeriod: '24 months for pre-existing diseases',
          hospitals: '12,000+ Cashless Network Hospitals',
          highlights: ['2X coverage from Day 1 at no extra cost', 'Restore benefit with 100% recharge', 'Zero deduction on non-medical items'],
          bestFor: 'Comprehensive family health protection'
        },
        {
          id: 'max-life-term',
          name: 'Max Life Smart Secure Plus',
          company: 'Max Life Insurance',
          type: 'Term Life Insurance',
          csr: '99.51% Claim Settlement Ratio',
          sumInsured: '₹50 Lakhs to ₹10 Crores',
          waitingPeriod: 'Instant accidental cover from Day 1',
          hospitals: 'N/A (Life Cover)',
          highlights: ['Terminal illness benefit built-in', 'Return of Premium option available', 'Special discounts for non-smokers and women'],
          bestFor: 'Family financial security & high sum assured'
        },
        {
          id: 'care-supreme',
          name: 'Care Supreme',
          company: 'Care Health Insurance',
          type: 'Health Insurance',
          csr: '95.2% Claim Settlement Ratio',
          sumInsured: '₹7 Lakhs to ₹1 Crore',
          waitingPeriod: '30 days initial, 3 years pre-existing',
          hospitals: '21,000+ Cashless Network Hospitals',
          highlights: ['Unlimited automatic recharge of sum insured', 'Cumulative bonus up to 500%', 'Annual health checkup included'],
          bestFor: 'High cumulative bonus and hospital network'
        }
      ]
    },
    US: {
      cards: [
        {
          id: 'chase-sapphire-preferred',
          name: 'Chase Sapphire Preferred',
          bank: 'Chase',
          type: 'Travel & Dining',
          annualFee: '$95',
          rewardRate: '3x on dining, 2x on travel, 5x on Chase Travel',
          lounge: 'Via Chase Sapphire Lounge (select airports)',
          forex: 'No foreign transaction fees (0%)',
          highlights: ['60,000 Bonus Points after spending $4,000 in 3 months', '1:1 point transfer to Hyatt, United, Southwest', 'Trip cancellation and primary rental car coverage'],
          bestFor: 'Beginner to intermediate travelers and dining rewards'
        },
        {
          id: 'amex-gold',
          name: 'American Express Gold Card',
          bank: 'American Express',
          type: 'Food & Groceries',
          annualFee: '$325',
          rewardRate: '4x at restaurants & US supermarkets (up to $25k/yr)',
          lounge: 'None (Amex Platinum for lounges)',
          forex: 'No foreign transaction fees (0%)',
          highlights: ['$120 Dining Credit + $120 Uber Cash annually', '4x points on global dining', 'Lucrative Membership Rewards points'],
          bestFor: 'Foodies, grocery shoppers & restaurant lovers'
        },
        {
          id: 'citi-double-cash',
          name: 'Citi Double Cash Card',
          bank: 'Citi',
          type: 'Flat Cashback',
          annualFee: '$0 (No annual fee)',
          rewardRate: '2% flat on everything (1% buy + 1% pay)',
          lounge: 'None',
          forex: '3% foreign fee',
          highlights: ['Simple flat 2% on all purchases without tracking categories', 'No cap on total cash back earned', 'Convertible to Citi ThankYou points'],
          bestFor: 'Everyday hassle-free non-category purchases'
        }
      ],
      insurance: [
        {
          id: 'kaiser-permanente',
          name: 'Kaiser Permanente HMO',
          company: 'Kaiser Permanente',
          type: 'Health Insurance',
          csr: '97.2% Claim Approval Rate',
          sumInsured: 'ACA Compliant / Out-of-pocket max $4,500 - $8,000',
          waitingPeriod: 'None on ACA plans',
          hospitals: 'Integrated Kaiser medical centers & partner networks',
          highlights: ['Highest rated customer satisfaction in US', 'Integrated pharmacies and doctors in single facilities', 'Comprehensive preventative care 100% covered'],
          bestFor: 'Integrated healthcare and low out-of-pocket copays'
        },
        {
          id: 'haven-life',
          name: 'MassMutual / Haven Term',
          company: 'MassMutual',
          type: 'Term Life Insurance',
          csr: '98.8% Claim Payout Ratio',
          sumInsured: '$250,000 to $3,000,000',
          waitingPeriod: 'Immediate approval with digital underwriting',
          hospitals: 'N/A',
          highlights: ['Backed by A++ financial strength MassMutual', 'No medical exam option for qualified applicants', 'Fixed level premiums for 10, 15, 20, 30 years'],
          bestFor: 'Simple, trusted term life coverage'
        }
      ]
    },
    UK: {
      cards: [
        {
          id: 'amex-ba-premium-plus',
          name: 'British Airways American Express Premium Plus',
          bank: 'American Express UK',
          type: 'Travel & Avios',
          annualFee: '£300',
          rewardRate: '1.5 Avios per £1 (3 Avios on BA spend)',
          lounge: 'Available via Priority Pass purchase',
          forex: '2.99% fee',
          highlights: ['Companion Voucher on spending £15,000 (2-for-1 on BA flights)', '25,000 bonus Avios introductory bonus', 'Comprehensive travel inconvenience insurance'],
          bestFor: 'UK residents flying British Airways & accumulating Avios'
        },
        {
          id: 'barclaycard-rewards',
          name: 'Barclaycard Rewards',
          bank: 'Barclays',
          type: 'Cashback & Travel',
          annualFee: '£0 (No annual fee)',
          rewardRate: '0.25% cashback on all spending',
          lounge: 'None',
          forex: 'Zero foreign transaction fees on abroad spending',
          highlights: ['Zero fees on purchases made abroad', 'Free cash withdrawals abroad without fee', 'Visa acceptance worldwide'],
          bestFor: 'Holidaymakers and fee-free international spending'
        }
      ],
      insurance: [
        {
          id: 'bupa-by-you',
          name: 'Bupa By You Private Health',
          company: 'Bupa UK',
          type: 'Private Health Insurance',
          csr: '96.5% Claim Settlement',
          sumInsured: 'Comprehensive private inpatient & outpatient',
          waitingPeriod: 'Moratorium or full medical underwriting',
          hospitals: 'All UK private hospitals and specialist clinics',
          highlights: ['Fast access to top consultants without NHS waiting times', 'Cancer Promise covering all breakthrough treatments', 'Digital GP app with 24/7 appointments'],
          bestFor: 'Skipping NHS waitlists for private specialists'
        }
      ]
    }
  };

  function init() {
    bindEvents();
    renderSubFilters();
    renderItems();
  }

  function bindEvents() {
    $('countrySelect').onchange = (e) => {
      currentCountry = e.target.value;
      renderItems();
    };

    document.querySelectorAll('[data-tab]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        currentTab = b.dataset.tab;
        currentSubFilter = 'all';
        renderSubFilters();
        renderItems();
      };
    });

    $('searchInput').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderItems();
    };

    $('btnAdvisorQuiz').onclick = () => {
      $('quizModal').hidden = false;
      $('quizResult').hidden = true;
    };
    $('closeQuizModal').onclick = () => { $('quizModal').hidden = true; };

    $('btnOpenCompare').onclick = showCompareModal;
    $('closeCompareModal').onclick = () => { $('compareModal').hidden = true; };

    $('quizForm').onsubmit = (e) => {
      e.preventDefault();
      runAdvisorQuiz();
    };
  }

  function renderSubFilters() {
    const filters = currentTab === 'cards'
      ? ['all', 'Cashback', 'Travel', 'Forex', 'Utilities']
      : ['all', 'Health Insurance', 'Term Life Insurance'];

    $('subFilters').innerHTML = filters.map(f => `
      <button class="wd-btn wd-btn-sm ${currentSubFilter === f ? 'wd-btn-primary' : ''}" data-sub="${f}">
        ${f === 'all' ? 'All' : f}
      </button>
    `).join('');

    document.querySelectorAll('[data-sub]').forEach(b => {
      b.onclick = () => {
        currentSubFilter = b.dataset.sub;
        renderSubFilters();
        renderItems();
      };
    });
  }

  function renderItems() {
    const countryData = DATA[currentCountry] || DATA['IN'];
    const items = countryData[currentTab] || [];

    const filtered = items.filter(it => {
      if (currentSubFilter !== 'all') {
        const typeStr = (it.type || '').toLowerCase();
        if (!typeStr.includes(currentSubFilter.toLowerCase())) return false;
      }
      if (searchQuery) {
        const nameMatch = (it.name || '').toLowerCase().includes(searchQuery);
        const orgMatch = ((it.bank || it.company) || '').toLowerCase().includes(searchQuery);
        const featMatch = (it.bestFor || '').toLowerCase().includes(searchQuery);
        if (!nameMatch && !orgMatch && !featMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      $('itemsGrid').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">💳</div>No entries found for this filter in the selected country.</div>';
      return;
    }

    $('itemsGrid').innerHTML = filtered.map(it => {
      const isSelected = selectedForCompare.has(it.id);
      const isCard = currentTab === 'cards';

      return `
        <div class="card" data-id="${esc(it.id)}">
          <div class="wd-row">
            <div>
              <div style="font-weight:700;font-size:16px">${esc(it.name)}</div>
              <div class="wd-small wd-muted">${esc(it.bank || it.company)} · ${esc(it.type)}</div>
            </div>
            <div class="wd-spacer"></div>
            <input type="checkbox" data-compare-check="${esc(it.id)}" ${isSelected ? 'checked' : ''} title="Select to compare" style="width:18px;height:18px;cursor:pointer">
          </div>

          <div class="wd-row" style="gap:6px;flex-wrap:wrap">
            ${isCard ? `
              <span class="badge b-green">Annual Fee: ${esc(it.annualFee)}</span>
              <span class="badge b-blue">${esc(it.forex)}</span>
            ` : `
              <span class="badge b-green">CSR: ${esc(it.csr)}</span>
              <span class="badge b-blue">Sum: ${esc(it.sumInsured)}</span>
            `}
          </div>

          <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">
            ${isCard ? `
              <div class="benefit-row"><span>🎁</span> <span><b>Rewards:</b> ${esc(it.rewardRate)}</span></div>
              <div class="benefit-row"><span>✈️</span> <span><b>Lounge:</b> ${esc(it.lounge)}</span></div>
            ` : `
              <div class="benefit-row"><span>🏥</span> <span><b>Hospitals:</b> ${esc(it.hospitals)}</span></div>
              <div class="benefit-row"><span>⏳</span> <span><b>Waiting Period:</b> ${esc(it.waitingPeriod)}</span></div>
            `}
          </div>

          <div style="font-size:12px;background:var(--wd-surface-2);padding:8px 10px;border-radius:6px;margin-top:4px">
            <b>Best for:</b> ${esc(it.bestFor)}
          </div>

          <ul style="margin:4px 0 0 0;padding-left:18px;font-size:12px;color:var(--wd-muted);line-height:1.5">
            ${(it.highlights || []).map(h => `<li>${esc(h)}</li>`).join('')}
          </ul>
        </div>
      `;
    }).join('');

    document.querySelectorAll('[data-compare-check]').forEach(chk => {
      chk.onchange = (e) => {
        const id = chk.dataset.compareCheck;
        if (e.target.checked) selectedForCompare.add(id);
        else selectedForCompare.delete(id);
        $('compareCount').textContent = selectedForCompare.size;
      };
    });
  }

  function showCompareModal() {
    if (selectedForCompare.size < 2) {
      wd.ui.toast('Please check at least 2 cards or insurance policies to compare', 'ok');
      return;
    }
    const countryData = DATA[currentCountry] || DATA['IN'];
    const all = [...(countryData.cards || []), ...(countryData.insurance || [])];
    const items = all.filter(it => selectedForCompare.has(it.id));

    const isCard = items[0].rewardRate !== undefined;

    let tableHtml = `
      <table class="compare-table">
        <thead>
          <tr>
            <th>Feature</th>
            ${items.map(it => `<th>${esc(it.name)}<br><span class="wd-small wd-muted">${esc(it.bank || it.company)}</span></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>Category</b></td>
            ${items.map(it => `<td>${esc(it.type)}</td>`).join('')}
          </tr>
          ${isCard ? `
            <tr><td><b>Annual Fee</b></td>${items.map(it => `<td>${esc(it.annualFee)}</td>`).join('')}</tr>
            <tr><td><b>Rewards & Cashback</b></td>${items.map(it => `<td>${esc(it.rewardRate)}</td>`).join('')}</tr>
            <tr><td><b>Lounge Access</b></td>${items.map(it => `<td>${esc(it.lounge)}</td>`).join('')}</tr>
            <tr><td><b>Forex Markup</b></td>${items.map(it => `<td>${esc(it.forex)}</td>`).join('')}</tr>
          ` : `
            <tr><td><b>Claim Ratio (CSR)</b></td>${items.map(it => `<td>${esc(it.csr)}</td>`).join('')}</tr>
            <tr><td><b>Sum Insured</b></td>${items.map(it => `<td>${esc(it.sumInsured)}</td>`).join('')}</tr>
            <tr><td><b>Waiting Period</b></td>${items.map(it => `<td>${esc(it.waitingPeriod)}</td>`).join('')}</tr>
            <tr><td><b>Network Hospitals</b></td>${items.map(it => `<td>${esc(it.hospitals)}</td>`).join('')}</tr>
          `}
          <tr>
            <td><b>Best For</b></td>
            ${items.map(it => `<td><b>${esc(it.bestFor)}</b></td>`).join('')}
          </tr>
        </tbody>
      </table>
    `;

    $('compareTableContainer').innerHTML = tableHtml;
    $('compareModal').hidden = false;
  }

  function runAdvisorQuiz() {
    const target = $('quizTarget').value;
    const obj = $('quizObjective').value;
    const countryData = DATA[currentCountry] || DATA['IN'];
    const pool = countryData[target] || [];

    let winner = pool[0];
    if (obj === 'cashback') {
      winner = pool.find(p => (p.name + p.type + p.bestFor).toLowerCase().includes('cashback')) || pool[0];
    } else if (obj === 'travel' || obj === 'forex') {
      winner = pool.find(p => (p.type + p.forex + p.bestFor).toLowerCase().includes('travel') || (p.forex || '').includes('Zero')) || pool[0];
    } else if (obj === 'health') {
      winner = pool.find(p => (p.type || '').toLowerCase().includes('health')) || pool[0];
    } else if (obj === 'term') {
      winner = pool.find(p => (p.type || '').toLowerCase().includes('term')) || pool[0];
    }

    $('quizResult').hidden = false;
    $('quizResult').innerHTML = `
      <div style="background:var(--wd-surface-2);border:2px solid var(--wd-primary);border-radius:12px;padding:16px">
        <div style="color:var(--wd-primary);font-weight:700;font-size:13px;text-transform:uppercase">Top Match Recommendation:</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${esc(winner.name)}</div>
        <div class="wd-small wd-muted">${esc(winner.bank || winner.company)} · ${esc(winner.type)}</div>
        <div style="margin-top:8px;font-size:13px"><b>Why it matches:</b> ${esc(winner.bestFor)}</div>
        <div style="margin-top:6px;font-size:13px;color:var(--wd-accent)"><b>Key Benefit:</b> ${esc(winner.rewardRate || winner.csr)}</div>
      </div>
    `;
  }

  init();
})();
