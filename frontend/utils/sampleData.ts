import { DocumentFile, Column } from '../types';

// Sample columns pre-configured for the Side Letter dataset
export const SAMPLE_COLUMNS: Column[] = [
  {
    id: 'col_sample_investor',
    name: 'Investor Entity',
    type: 'text',
    prompt: 'Identify the full legal name of the Investor entity.',
    status: 'idle',
    width: 250
  },
  {
    id: 'col_sample_date',
    name: 'Date',
    type: 'date',
    prompt: 'What is the date of the letter agreement?',
    status: 'idle',
    width: 250
  },
  {
    id: 'col_sample_commitment',
    name: 'Commitment Amount',
    type: 'number',
    prompt: 'Return as a number the commitment amount of the investor as shown in the side letter.',
    status: 'idle',
    width: 250
  },
  {
    id: 'col_sample_mfn',
    name: 'MFN',
    type: 'boolean',
    prompt: 'Is there a Most Favored Nation (MFN) clause?',
    status: 'idle',
    width: 200
  },
  {
    id: 'col_sample_coinvest',
    name: 'Co-Investment Rights',
    type: 'text',
    prompt: 'Extract the full text of the Co-Investment clause.',
    status: 'idle',
    width: 350
  },
  {
    id: 'col_sample_poa',
    name: 'Power of Attorney',
    type: 'text',
    prompt: 'Extract the full text of the Power of Attorney clause.',
    status: 'idle',
    width: 350
  }
];

const DOC_1_METROPOLITAN = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____J_u_l_y_ 1_5_,_____ 2025

Metropolitan College Foundation
321 Endowment Drive,
University City, MA 02138

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). Metropolitan College Foundation (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $25,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicle.
The General Partner agrees that the Investor shall not be required to participate in an Investment through an Alternative Investment Vehicle, without the Investor's consent (which consent shall not be unreasonably withheld or delayed), if such participation would materially and adversely impact the Investor's economic return on such Investment as compared to investing through the Partnership, provided that in making such determination the Investor shall act in good faith.

2. Co-Investment.
The General Partner hereby acknowledges that the Investor has notified the General Partner of its interest in co-investment opportunities that the General Partner may offer to the Limited Partners pursuant to Section 7.10.

3. Distributions in Kind.
The General Partner acknowledges that, in relation to any distribution in kind to be made prior to the termination of the Partnership pursuant to Section 3.3, the Investor shall be deemed to have given the General Partner notice in accordance with Section 3.3(b) that it wishes the General Partner to retain the Investor's proportion of the relevant Investment to be distributed in kind and, on behalf of the Investor, use its reasonable endeavours to dispose of such securities and distribute the net proceeds of such disposition to the Investor in accordance with Section 3.3(b).

4. Limited Liability.
The General Partner agrees that it will use reasonable best efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes an Investment.

5. List of Advisory Board Members.
Promptly following the Final Closing Date, the General Partner shall, subject to any applicable confidentiality obligations, provide the Investor a list of the voting members and non-voting observers of the Advisory Board and the names of the Limited Partners which each of the members and observers represents. The General Partner further agrees that it shall as soon as reasonably practicable provide such list, including any updates if any, to the Investor.

6. Power of Attorney.
The General Partner hereby confirms that the power of attorney granted to the General Partner in the Partnership Agreement and the Subscription Agreement are intended to be, and shall only be, limited solely to those items expressly permitted under the relevant grant of authority. Further, the General Partner shall provide the Investor with copies of any documents signed on behalf of the Investor pursuant to any such power of attorney.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

METROPOLITAN COLLEGE FOUNDATION
By: _____________________________
Name: Robert Thompson
Title: Chief Investment Officer
`;

const DOC_2_GLOBAL = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____J_u_l_y_ 1_5_,_____ 2025

Global Pension Trust
555 Regulatory Plaza,
Financial District, NY 10006

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). Global Pension Trust (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $100,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicles.
The General Partner agrees that the Investor shall not be required to participate in an Investment through an Alternative Investment Vehicle, without the Investor's consent (which consent shall not be unreasonably withheld or delayed), if such participation would materially and adversely impact the Investor's economic return on such Investment as compared to investing through the Partnership, provided that in making such determination the Investor shall act in good faith. The General Partner confirms that it will provide the Investor with copies of the organizational documents of any Alternative Investment Vehicle organized pursuant to the Partnership Agreement in which the Investor will invest at least 5 Business Days prior to its admission to such Alternative Investment Vehicle.

2. Co-Investment Opportunities.
The Investor has notified the General Partner of its interest in co-investment opportunities that the General Partner may offer to the Limited Partners pursuant to Section 7.10, including any amount of co-investment opportunity that arises from another Limited Partner declining to participate in all or a portion of its share of any such co-investment opportunity. In consideration of the Investor's status as a fund managed or advised by a supranational financial institution, the General Partner agrees that (a) co-investment opportunities offered to the Investor shall, on a pro rata basis and subject to applicable legal, regulatory, tax and accounting considerations, be on terms no less favourable than the terms of the same co-investment opportunities offered to any other Limited Partner in the Partnership, and (b) the Investor may assign any co-investment opportunity declined by it to an Affiliate of the Investor.

3. Distributions in Kind.
The General Partner acknowledges that, in relation to any distribution in kind to be made prior to the termination of the Partnership pursuant to Section 3.3, the Investor will be deemed to have given the General Partner notice in accordance with Section 3.3(b) that it wishes the General Partner to retain the Investor's proportion of the relevant Investment to be distributed in kind and, on behalf of the Investor, use its reasonable endeavours to dispose of such securities and distribute the net proceeds of such disposition to the Investor in accordance with Section 3.3(b). The General Partner further agrees that it shall use commercially reasonable efforts to obtain the best price possible with respect to any sale of securities on the Investor's behalf pursuant to this paragraph, provided that the General Partner shall not be subject to any liability whatsoever to the Investor in relation to any pricing actually achieved (or not) for any such sale.

4. Limited Liability.
The General Partner agrees that it shall use reasonable best efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes an Investment; provided that the laws of such jurisdiction shall recognise the limited liability of the Investor to substantially the same extent in all material aspects as provided in the Partnership Agreement.

5. List of Advisory Board Members.
Promptly following the Final Closing Date and in any event within five (5) Business Days of any change to the composition of the Advisory Board, the General Partner shall provide the Investor with an up-to-date list of the voting members and non-voting observers of the Advisory Board and the names of the Limited Partners which each of the members and observers represents.

6. Power of Attorney.
The General Partner hereby agrees that the power of attorney granted to the General Partner by the Investor pursuant to the Partnership Agreement and the Investor's Subscription Agreement shall be automatically revoked if the General Partner files a petition in bankruptcy or is dissolved, in each case upon the occurrence of any such event.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

GLOBAL PENSION TRUST
By: _____________________________
Name: Michael Rodriguez
Title: Chief Investment Officer
`;

const DOC_3_STATE = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____J_u_l_y_ 1_5_,_____ 2025

State University Endowment Fund
789 University Avenue,
College Town, CA 90210

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). State University Endowment Fund (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $50,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicles.
The General Partner agrees that the Investor shall not be required to participate in any Investment through an Alternative Investment Vehicle without its prior written consent, which may be withheld in the Investor's sole discretion.

2. Co-Investment.
The General Partner acknowledges that the Investor has expressed an interest to participate in co-investment opportunities offered to the Limited Partners pursuant to Section 7.10. In consideration of the Investor's status as a company directly or indirectly owned by a sovereign non-U.S. government, the General Partner agrees that (a) co-investment opportunities offered to the Investor shall, on a pro rata basis and subject to applicable legal, regulatory, tax and accounting considerations, be on terms no less favourable than the terms of the same co-investment opportunities offered to any other Limited Partner in the Partnership, and (b) the Investor may assign any co-investment opportunity declined by it to an Affiliate of the Investor. The General Partner has no understanding, oral or written, with any Limited Partner or any investor in any Parallel Fund with respect to co-investment rights other than as set forth in the Partnership Agreement or a Side Letter entered into with a Limited Partner. Any co-investment made by the Investor shall not be subject to any management fee or carried interest.

3. Distributions in Kind.
In relation to any distribution in kind to be made prior to the termination of the Partnership pursuant to Section 3.3 where the Investor elects to receive net proceeds of such distribution in lieu of securities in kind as contemplated under Section 3.3: (a) the General Partner shall waive any requirement under Section 3.3(b) for the Investor to provide an opinion of counsel; and (b) the General Partner agrees to use commercially reasonable efforts to sell all or any portion of such securities on the Investor's behalf at the best possible price and distribute the net proceeds of such sale to the Investor; provided that, the Investor acknowledges and agrees that the price of such securities may be volatile and subject to fluctuations as a result of certain factors which are not controlled by the General Partner and the actual price of the securities sold may be higher or lower than the value as determined pursuant to Section 3.3(a)(i) as of the date of distribution.

4. Limited Liability.
The General Partner agrees that it shall use all commercially reasonable efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes an Investment; provided that the laws of such jurisdiction shall recognise the limited liability of the Investor to substantially the same extent in all material aspects as provided in the Partnership Agreement.

5. List of Advisory Board Members.
Upon the reasonable request of the Investor, the General Partner shall, subject to any applicable confidentiality obligations, provide the Investor a list of the voting members and non-voting observers of the Advisory Board and the names of the Limited Partners which each of the members and observers represents.

6. Power of Attorney.
In consideration of the Investor's status as a wholly-owned subsidiary of a publically traded company, the General Partner hereby confirms that the power of attorney granted to the General Partner in the Partnership Agreement and the Subscription Agreement are intended to be ministerial in scope and limited solely to those items expressly permitted under the relevant grant of authority, and such powers of attorney are not intended to be a general grant of power to independently exercise discretionary judgment on the Investor's behalf. Further, as soon as reasonably practicable, the General Partner shall provide the Investor with copies of any documents signed on behalf of the Investor pursuant to any such power of attorney.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

STATE UNIVERSITY ENDOWMENT FUND
By: _____________________________
Name: Sarah Lee
Title: Investment Director
`;

const DOC_4_TEACHERS = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____J_u_l_y_ 1_5_,_____ 2025

Teachers' Retirement System
456 Pension Plaza,
Capital City, TX 75201

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). Teachers' Retirement System (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $75,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicle.
The General Partner agrees that the Investor shall not be required to be admitted to such Alternative Investment Vehicle without the Investor's prior written consent, which consent shall not be unreasonably withheld or delayed. The Investor shall notify the General Partner of such consent within seven (7) Business Days from the date it received the written notice from the General Partner with respect to the formation of the Alternative Investment Vehicle.

2. Co-Investment.
The General Partner hereby acknowledges that the Investor has notified the General Partner of its interest in co-investment opportunities that the General Partner may offer to the Limited Partners pursuant to Section 7.10. The General Partner hereby agrees that if the Investor participates in any such co-investment opportunity, it shall be offered to the Investor on a basis free from management fee and carried interest.

3. Distributions in Kind.
The Fund Parties acknowledge that, in relation to any distribution in kind to be made prior to the termination of the Partnership pursuant to Section 3.3, the Investor shall be deemed to have given the General Partner notice in accordance with Section 3.3(b) that it wishes the General Partner to retain the Investor's proportion of the relevant Investment to be distributed in kind and, on behalf of the Investor, use its commercially reasonable endeavours to dispose of such securities for the best price possible with respect to any sale of such securities on the Investor's behalf, provided that the General Partner shall not be subject to any liability whatsoever to the Investor in relation to any pricing actually achieved (or not) for any such sale, and distribute the net proceeds of such disposition to the Investor in accordance with Section 3.3(b). Notwithstanding Section 3.3(b), the General Partner agrees that it shall be liable to the Investor for its fraud, gross negligence or wilful misfeasance with respect to any such disposition.

4. Limited Liability.
The General Partner agrees that it shall use commercially reasonable efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes an Investment.

5. List of Advisory Board Members.
Promptly following the Final Closing Date, the General Partner shall, subject to any applicable confidentiality obligations, provide the Investor a list of the voting members and non-voting observers of the Advisory Board and the names of the Limited Partners which each of the members and observers represents. The General Partner further agrees that upon reasonable request of the Investor thereafter, it shall provide such list, including any updates if any, to the Investor.

6. Power of Attorney.
The General Partner hereby confirms that the power of attorney granted to the General Partner in the Partnership Agreement and the Subscription Agreement are intended to be, and shall only be, limited solely to those items expressly permitted under the relevant grant of authority. Further, as soon as reasonably practicable, the General Partner shall provide the Investor with copies of any documents signed on behalf of the Investor pursuant to any such power of attorney.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

TEACHERS' RETIREMENT SYSTEM
By: _____________________________
Name: Jennifer Kim
Title: Chief Investment Officer
`;

const DOC_5_PACIFIC = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____July 15, 2025_____

Pacific Coast Retirement Fund
1500 Ocean Drive,
San Francisco, CA 94102

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). Pacific Coast Retirement Fund (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $85,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicle.
The General Partner agrees that the Investor shall not be required to participate in an Investment through an Alternative Investment Vehicle without the Investor's prior written consent, which consent shall not be unreasonably withheld or delayed. The General Partner shall provide the Investor with at least ten (10) Business Days prior written notice and all relevant documentation regarding any proposed Alternative Investment Vehicle, including organizational documents and an analysis of the economic and tax implications of such participation. The Investor shall not be required to participate if such participation would materially and adversely impact the Investor's economic return or result in adverse tax or regulatory consequences.

2. Co-Investment Opportunities.
The Investor has notified the General Partner of its interest in co-investment opportunities that the General Partner may offer to the Limited Partners pursuant to Section 7.10. The General Partner agrees that (a) co-investment opportunities offered to the Investor shall, on a pro rata basis and subject to applicable legal, regulatory, tax and accounting considerations, be on terms no less favourable than the terms of the same co-investment opportunities offered to any other Limited Partner in the Partnership (including with respect to economics, governance, and information rights), (b) any co-investment made by the Investor shall not be subject to any management fee or carried interest, and (c) the Investor may assign any co-investment opportunity declined by it to an Affiliate of the Investor.

3. Distributions in Kind.
The General Partner acknowledges that, in relation to any distribution in kind to be made prior to the termination of the Partnership pursuant to Section 3.3, the Investor shall be deemed to have given the General Partner notice in accordance with Section 3.3(b) that it wishes the General Partner to retain the Investor's proportion of the relevant Investment to be distributed in kind and, on behalf of the Investor, use its commercially reasonable efforts to dispose of such securities at the best price reasonably obtainable under the circumstances and distribute the net proceeds of such disposition to the Investor in accordance with Section 3.3(b). The General Partner shall provide the Investor with prior notice of any proposed sale and consult with the Investor regarding timing and pricing considerations. The General Partner shall not be liable for any losses resulting from market fluctuations, provided it has exercised commercially reasonable efforts.

4. Limited Liability.
The General Partner agrees that it shall use all commercially reasonable efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes an Investment; provided that the laws of such jurisdiction shall recognise the limited liability of the Investor to substantially the same extent in all material aspects as provided in the Partnership Agreement. The General Partner shall provide the Investor with prior written notice and an opportunity to consult regarding any Investment that may present limited liability concerns.

5. List of Advisory Board Members.
Promptly following the Final Closing Date and within five (5) Business Days of any change to the composition of the Advisory Board, the General Partner shall, subject to any applicable confidentiality obligations, provide the Investor with a current list of the voting members and non-voting observers of the Advisory Board and the names of the Limited Partners which each of the members and observers represents.

6. Power of Attorney.
The General Partner hereby confirms that the power of attorney granted to the General Partner in the Partnership Agreement and the Subscription Agreement are intended to be ministerial in scope and limited solely to those items expressly permitted under the relevant grant of authority, and such powers of attorney are not intended to be a general grant of power to independently exercise discretionary judgment on the Investor's behalf. The General Partner shall provide the Investor with copies of any documents signed on behalf of the Investor pursuant to any such power of attorney within five (5) Business Days of execution.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

PACIFIC COAST RETIREMENT FUND
By: _____________________________
Name: James Chen
Title: Executive Director
`;

const DOC_6_HERITAGE = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____July 15, 2025_____

Heritage Insurance Group
200 Insurance Way,
Hartford, CT 06103

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). Heritage Insurance Group (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $40,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicle.
The General Partner agrees to provide the Investor with at least three (3) Business Days prior written notice before requiring the Investor to participate in an Investment through an Alternative Investment Vehicle. The Investor shall not be required to participate in such Alternative Investment Vehicle if it would result in material adverse tax or regulatory consequences to the Investor, provided that the Investor provides reasonable documentation of such consequences.

2. Co-Investment.
The General Partner acknowledges that the Investor has expressed interest in co-investment opportunities that may be offered to Limited Partners pursuant to Section 7.10. The General Partner agrees to notify the Investor of such opportunities when they become available, subject to the terms and conditions set forth in the Partnership Agreement.

3. Distributions in Kind.
In relation to any distribution in kind to be made pursuant to Section 3.3, the Investor may elect to receive such distribution in kind or request that the General Partner dispose of the Investor's proportion of such securities and distribute the net proceeds to the Investor. If the Investor elects to receive cash, the General Partner shall use reasonable efforts to dispose of such securities at prevailing market prices.

4. Limited Liability.
The General Partner agrees that it will use reasonable best efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes an Investment.

5. List of Advisory Board Members.
Within thirty (30) days following the Final Closing Date, the General Partner shall, subject to any applicable confidentiality obligations, provide the Investor with a list of the voting members and non-voting observers of the Advisory Board. The General Partner shall provide updated lists upon the reasonable request of the Investor.

6. Power of Attorney.
The General Partner confirms that the power of attorney granted to the General Partner in the Partnership Agreement and the Subscription Agreement shall be limited to those items expressly permitted under the relevant grant of authority. The General Partner shall provide the Investor with copies of material documents signed on behalf of the Investor pursuant to such power of attorney upon request.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

HERITAGE INSURANCE GROUP
By: _____________________________
Name: Patricia Williams
Title: Chief Investment Officer
`;

const DOC_7_NORDIC = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____July 15, 2025_____

Nordic Pension Alliance
15 Fjord Street,
Oslo, Norway 0150

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). Nordic Pension Alliance (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $120,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicles.
The General Partner agrees that the Investor shall have the absolute right to decline participation in any Alternative Investment Vehicle in its sole and absolute discretion. The General Partner shall provide the Investor with at least fifteen (15) Business Days prior written notice and comprehensive documentation regarding any proposed Alternative Investment Vehicle, including but not limited to: (a) complete organizational and governing documents, (b) a detailed analysis prepared by independent counsel and tax advisors of all economic, tax, legal and regulatory implications of such participation, (c) a comparison of the economic terms of investing through the Alternative Investment Vehicle versus investing directly through the Partnership, and (d) written confirmation that participation in such Alternative Investment Vehicle will not result in any diminution of the Investor's economic returns, rights, or protections as compared to investing directly through the Partnership. If the Investor declines to participate in an Alternative Investment Vehicle, the General Partner shall use its best efforts to structure the Investment in a manner that allows the Investor to participate directly through the Partnership on equivalent economic terms.

2. Co-Investment Opportunities.
The Investor has notified the General Partner of its interest in co-investment opportunities. The General Partner hereby agrees that: (a) the Investor shall have a right of first offer with respect to all co-investment opportunities, with the right to participate in up to 100% of any co-investment opportunity before it is offered to any other Limited Partner, (b) all co-investment opportunities offered to the Investor shall be on terms no less favourable than the terms offered to any other Limited Partner or any Affiliate of the General Partner (including with respect to economics, governance, information rights, exit rights, and all other material terms), (c) any co-investment made by the Investor shall be entirely free from management fees, carried interest, organizational expenses, and all other fees and expenses except for the Investor's pro rata share of direct investment expenses, (d) the Investor may assign or syndicate any co-investment opportunity (in whole or in part) to any Affiliate or third party designated by the Investor, and (e) the General Partner shall provide the Investor with at least fifteen (15) Business Days to evaluate any co-investment opportunity, with full access to all due diligence materials and management presentations.

3. Distributions in Kind.
The General Partner acknowledges and agrees that, in relation to any distribution in kind to be made pursuant to Section 3.3, the Investor shall have the absolute right to elect to receive cash in lieu of securities. Upon any such election by the Investor (which election shall be deemed to have been made automatically without any notice requirement), the General Partner shall: (a) retain the Investor's proportion of the relevant Investment to be distributed in kind, (b) use its best efforts to dispose of such securities at the best price reasonably obtainable, including by engaging one or more investment banks or brokers to conduct a market sale or other disposition process, (c) consult with the Investor regarding the timing, method and terms of any proposed disposition and obtain the Investor's prior written approval for any disposition at a price more than 5% below the valuation used for distribution purposes, (d) provide the Investor with weekly updates on market conditions and disposition efforts, and (e) distribute the net proceeds of such disposition to the Investor within five (5) Business Days of receipt. The General Partner shall be liable to the Investor for any losses resulting from the General Partner's failure to exercise best efforts or comply with the requirements of this paragraph, including losses resulting from gross negligence, wilful misconduct, or breach of fiduciary duty. Notwithstanding Section 3.3(b), the General Partner hereby waives any requirement for the Investor to provide an opinion of counsel or any other documentation in connection with such election.

4. Limited Liability.
The General Partner agrees that it shall use its best efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes or proposes to make an Investment. The General Partner shall not cause the Partnership to make any Investment in any jurisdiction unless: (a) the laws of such jurisdiction recognise the limited liability of the Investor to the same extent and in all respects as provided in the Partnership Agreement, (b) the General Partner has obtained a written opinion from reputable local counsel confirming that the Investor's limited liability will be maintained in such jurisdiction, and (c) the General Partner has provided such opinion to the Investor at least ten (10) Business Days prior to making such Investment and the Investor has not objected. If at any time the General Partner becomes aware of any circumstances that may threaten or compromise the limited liability of the Investor, the General Partner shall immediately notify the Investor and take all necessary actions to remedy such circumstances at the Partnership's expense.

5. List of Advisory Board Members.
Immediately following the Final Closing Date and within two (2) Business Days of any change to the composition of the Advisory Board, the General Partner shall provide the Investor with a complete and current list of: (a) all voting members and non-voting observers of the Advisory Board, (b) the names of the Limited Partners which each of the members and observers represents, (c) the capital commitments of such Limited Partners, (d) biographical information for each member and observer, and (e) any conflicts of interest or related party relationships involving any member or observer. The General Partner shall provide such information notwithstanding any confidentiality obligations, and the Investor agrees to maintain the confidentiality of such information in accordance with the Partnership Agreement.

6. Power of Attorney.
The General Partner hereby confirms and agrees that: (a) the power of attorney granted to the General Partner in the Partnership Agreement and the Subscription Agreement is strictly limited to ministerial and administrative matters expressly identified in such documents and does not grant the General Partner any discretionary authority or the right to exercise independent judgment on behalf of the Investor, (b) such power of attorney shall automatically terminate and be of no further force or effect upon: (i) the General Partner's filing of a petition in bankruptcy or insolvency, (ii) the dissolution or liquidation of the General Partner, (iii) any change of control of the General Partner, (iv) the removal or resignation of the General Partner, or (v) any material breach by the General Partner of its obligations under the Partnership Agreement or this Letter Agreement, (c) the General Partner shall provide the Investor with copies of any and all documents signed on behalf of the Investor pursuant to such power of attorney immediately upon execution (and in any event within one (1) Business Day), together with a detailed explanation of the purpose and effect of such documents, and (d) the General Partner shall obtain the Investor's prior written consent before executing any document on behalf of the Investor pursuant to such power of attorney that relates to any amendment of the Partnership Agreement, any waiver of the Investor's rights, any consent to a conflict of interest, or any other matter that could materially adversely affect the Investor.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

NORDIC PENSION ALLIANCE
By: _____________________________
Name: Ingrid Larsson
Title: Chief Investment Officer
`;

const DOC_8_SOVEREIGN = `GLOBAL VENTURES MANAGEMENT
c/o Corporate Services Inc.
1000 Financial District,
New York, NY 10005

_____July 15, 2025_____

Sovereign Wealth Partners
888 Capital Boulevard,
Investment City, UAE 00001

Re: Horizon Growth Fund I, L.P.

Ladies and Gentlemen:

Reference is hereby made to the Second Amended and Restated Agreement of Exempted Limited Partnership, dated August 1, 2024, as amended, restated or modified from time to time (the "Partnership Agreement"), of Horizon Growth Fund I, L.P., a Delaware exempted limited partnership (the "Partnership"), and the related Subscription Agreement of the Investor (as defined below). Sovereign Wealth Partners (the "Investor") is, contemporaneously herewith, subscribing for a limited partner interest in the Partnership and, assuming satisfaction of the conditions contained in the Partnership Agreement and the Investor's Subscription Agreement, will become a Limited Partner with a capital commitment of $150,000,000 (the "Commitment"). Capitalized terms used in this letter agreement (this "Letter Agreement") and not otherwise defined shall have the meanings set forth in the Partnership Agreement and all "Section" references herein shall refer to sections in the Partnership Agreement. In consideration of the proposed investment by the Investor in the Partnership, the General Partner, for itself and on behalf of the Partnership, on the one hand and the Investor, on the other hand, agree as follows:

1. Alternative Investment Vehicle.
The General Partner may require the Investor to participate in an Investment through an Alternative Investment Vehicle if the General Partner determines, in its reasonable discretion, that such participation is advisable for legal, regulatory, tax or other reasons.

2. Co-Investment.
The Investor acknowledges that co-investment opportunities may be offered to Limited Partners from time to time at the sole discretion of the General Partner pursuant to Section 7.10. The Investor further acknowledges that the General Partner shall have no obligation to offer any co-investment opportunities to the Investor and that any such opportunities shall be offered on terms determined by the General Partner in its sole discretion.

3. Distributions in Kind.
The Investor agrees to accept distributions in kind in accordance with Section 3.3 of the Partnership Agreement. The Investor acknowledges that such distributions may include illiquid securities and that the General Partner shall have no obligation to dispose of such securities on behalf of the Investor.

4. Limited Liability.
The General Partner shall use reasonable efforts to maintain the limited liability of the Investor as a matter of local law in any jurisdiction in which the Partnership makes an Investment, to the extent such efforts do not materially adversely affect the Partnership or other Limited Partners.

5. List of Advisory Board Members.
Upon written request of the Investor, the General Partner may, subject to any applicable confidentiality obligations and in its sole discretion, provide the Investor with information regarding the composition of the Advisory Board.

6. Power of Attorney.
The Investor acknowledges and agrees to the power of attorney granted to the General Partner in the Partnership Agreement and the Subscription Agreement, which shall be irrevocable and coupled with an interest to the fullest extent permitted by applicable law.

7. Miscellaneous.
This Letter Agreement shall be governed by, construed and enforced in accordance with the laws of the Cayman Islands, without regard to the conflict of law rules thereof. This Letter Agreement supplements the Partnership Agreement and the Investor's Subscription Agreement. In the event of a conflict between the provisions of this Letter Agreement and the Partnership Agreement or the Investor's Subscription Agreement, the provisions of this Letter Agreement shall control with respect to the parties hereto. Each provision of this Letter Agreement shall be considered severable. If it is determined by a court of competent jurisdiction that any provision of this Letter Agreement is invalid under applicable law, such provision shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of this Letter Agreement. This Letter Agreement shall terminate and be of no further force or effect if the Investor fails to maintain at least 50% of its Commitment or becomes a Defaulting Partner. This Letter Agreement may be executed in multiple counterparts, each of which shall be deemed an original and all of which taken together shall constitute one and the same instrument. The rights and obligations arising under this Letter Agreement may not be assigned by the Investor without the prior written consent of the General Partner; provided that, the General Partner shall not unreasonably withhold such consent in relation to an assignment of this Letter Agreement to any Affiliate of the Investor to whom the Investor has assigned all of its entire beneficial interest in the Partnership, to the extent such terms and conditions are reasonably applicable to such Affiliate. This Letter Agreement may be amended only through a written agreement between the parties hereto.

[Remainder of page intentionally left blank; signature page to follow] * * * * *

GLOBAL VENTURES MANAGEMENT
By: _____________________________
Name: David Chen
Title: Managing Partner

SOVEREIGN WEALTH PARTNERS
By: _____________________________
Name: Ahmed Al-Mansouri
Title: Managing Director
`;

const SIDE_LETTERS_DOCS = [
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_Metropolitan_College.pdf", content: DOC_1_METROPOLITAN },
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_Global_Pension_Trust.pdf", content: DOC_2_GLOBAL },
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_State_University_Endowment_Fund.pdf", content: DOC_3_STATE },
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_Teachers_Retirement_System.pdf", content: DOC_4_TEACHERS },
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_Pacific_Coast_Retirement_Fund.pdf", content: DOC_5_PACIFIC },
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_Heritage_Insurance_Group.pdf", content: DOC_6_HERITAGE },
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_Nordic_Pension_Alliance.pdf", content: DOC_7_NORDIC },
  { name: "Horizon_Growth_Fund_I_LP_Side_Letter_Sovereign_Wealth_Partners.pdf", content: DOC_8_SOVEREIGN },
];

export const generateSampleFiles = (): DocumentFile[] => {
  return SIDE_LETTERS_DOCS.map((doc, index) => {
    // Encode text to base64 to match the app's expected file format
    const content = btoa(doc.content);

    return {
      id: `sample_doc_${index}`,
      name: doc.name,
      type: "application/pdf", 
      size: 25000 + Math.floor(Math.random() * 10000), 
      content: content,
      mimeType: "text/plain" 
    };
  });
};