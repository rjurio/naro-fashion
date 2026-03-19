export interface SizeGuideTemplate {
  id: string;
  name: string;
  description: string;
  contentEn: string;
  contentSw: string;
}

export const SIZE_GUIDE_TEMPLATES: SizeGuideTemplate[] = [
  {
    id: 'fashion-general',
    name: 'Fashion & Clothing (General)',
    description: 'Standard size guide for dresses, tops, bottoms — women & men with international conversions',
    contentEn: `<h2>How to Measure</h2>
<p>For the best fit, take your measurements while wearing lightweight clothing. Use a soft measuring tape and keep it snug but not tight.</p>
<ul>
  <li><strong>Bust/Chest:</strong> Measure around the fullest part of your chest, keeping the tape level.</li>
  <li><strong>Waist:</strong> Measure around your natural waistline, the narrowest part of your torso.</li>
  <li><strong>Hips:</strong> Measure around the fullest part of your hips, about 20cm below your waist.</li>
  <li><strong>Length:</strong> Measure from the highest point of your shoulder down to the desired length.</li>
</ul>

<h2>Women's Size Chart</h2>
<table>
  <thead>
    <tr><th>Size</th><th>US</th><th>UK</th><th>EU</th><th>Bust (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>XS</td><td>0-2</td><td>4-6</td><td>32-34</td><td>78-82</td><td>60-64</td><td>86-90</td></tr>
    <tr><td>S</td><td>4-6</td><td>8-10</td><td>36-38</td><td>83-87</td><td>65-69</td><td>91-95</td></tr>
    <tr><td>M</td><td>8-10</td><td>12-14</td><td>40-42</td><td>88-92</td><td>70-74</td><td>96-100</td></tr>
    <tr><td>L</td><td>12-14</td><td>16-18</td><td>44-46</td><td>93-97</td><td>75-79</td><td>101-105</td></tr>
    <tr><td>XL</td><td>16-18</td><td>20-22</td><td>48-50</td><td>98-103</td><td>80-85</td><td>106-111</td></tr>
    <tr><td>XXL</td><td>20-22</td><td>24-26</td><td>52-54</td><td>104-110</td><td>86-92</td><td>112-118</td></tr>
  </tbody>
</table>

<h2>Men's Size Chart</h2>
<table>
  <thead>
    <tr><th>Size</th><th>US/UK</th><th>EU</th><th>Chest (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>S</td><td>34-36</td><td>44-46</td><td>86-91</td><td>71-76</td><td>86-91</td></tr>
    <tr><td>M</td><td>38-40</td><td>48-50</td><td>97-102</td><td>81-86</td><td>97-102</td></tr>
    <tr><td>L</td><td>42-44</td><td>52-54</td><td>107-112</td><td>91-96</td><td>107-112</td></tr>
    <tr><td>XL</td><td>46-48</td><td>56-58</td><td>117-122</td><td>101-106</td><td>117-122</td></tr>
    <tr><td>XXL</td><td>50-52</td><td>60-62</td><td>127-132</td><td>111-116</td><td>127-132</td></tr>
  </tbody>
</table>

<h2>Tips for a Perfect Fit</h2>
<ul>
  <li>If you are between sizes, we recommend choosing the larger size for comfort.</li>
  <li>For a fitted look, choose your exact size. For a relaxed fit, go one size up.</li>
  <li>Measurements may vary slightly between styles. Check individual product descriptions for specific guidance.</li>
  <li>Need help? Contact our team for personalized sizing assistance.</li>
</ul>`,
    contentSw: `<h2>Jinsi ya Kupima</h2>
<p>Kwa kupata saizi inayofaa, pima mwili wako ukiwa umevaa nguo nyepesi. Tumia kipimo laini na usikaze sana.</p>
<ul>
  <li><strong>Kifua:</strong> Pima sehemu pana zaidi ya kifua chako, weka kipimo sawa.</li>
  <li><strong>Kiuno:</strong> Pima sehemu nyembamba zaidi ya kiuno chako.</li>
  <li><strong>Makalio:</strong> Pima sehemu pana zaidi ya makalio yako.</li>
  <li><strong>Urefu:</strong> Pima kutoka bega hadi urefu unaotaka.</li>
</ul>

<h2>Chati ya Saizi za Wanawake</h2>
<table>
  <thead>
    <tr><th>Saizi</th><th>US</th><th>UK</th><th>EU</th><th>Kifua (cm)</th><th>Kiuno (cm)</th><th>Makalio (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>XS</td><td>0-2</td><td>4-6</td><td>32-34</td><td>78-82</td><td>60-64</td><td>86-90</td></tr>
    <tr><td>S</td><td>4-6</td><td>8-10</td><td>36-38</td><td>83-87</td><td>65-69</td><td>91-95</td></tr>
    <tr><td>M</td><td>8-10</td><td>12-14</td><td>40-42</td><td>88-92</td><td>70-74</td><td>96-100</td></tr>
    <tr><td>L</td><td>12-14</td><td>16-18</td><td>44-46</td><td>93-97</td><td>75-79</td><td>101-105</td></tr>
    <tr><td>XL</td><td>16-18</td><td>20-22</td><td>48-50</td><td>98-103</td><td>80-85</td><td>106-111</td></tr>
    <tr><td>XXL</td><td>20-22</td><td>24-26</td><td>52-54</td><td>104-110</td><td>86-92</td><td>112-118</td></tr>
  </tbody>
</table>

<h2>Chati ya Saizi za Wanaume</h2>
<table>
  <thead>
    <tr><th>Saizi</th><th>US/UK</th><th>EU</th><th>Kifua (cm)</th><th>Kiuno (cm)</th><th>Makalio (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>S</td><td>34-36</td><td>44-46</td><td>86-91</td><td>71-76</td><td>86-91</td></tr>
    <tr><td>M</td><td>38-40</td><td>48-50</td><td>97-102</td><td>81-86</td><td>97-102</td></tr>
    <tr><td>L</td><td>42-44</td><td>52-54</td><td>107-112</td><td>91-96</td><td>107-112</td></tr>
    <tr><td>XL</td><td>46-48</td><td>56-58</td><td>117-122</td><td>101-106</td><td>117-122</td></tr>
    <tr><td>XXL</td><td>50-52</td><td>60-62</td><td>127-132</td><td>111-116</td><td>127-132</td></tr>
  </tbody>
</table>

<h2>Vidokezo vya Kupata Saizi Sahihi</h2>
<ul>
  <li>Ukiwa kati ya saizi mbili, tunapendekeza uchague saizi kubwa zaidi kwa starehe.</li>
  <li>Kwa mtindo wa kubana, chagua saizi yako halisi. Kwa mtindo huru, panda saizi moja.</li>
  <li>Vipimo vinaweza kutofautiana kidogo kati ya mitindo. Angalia maelezo ya bidhaa.</li>
  <li>Unahitaji msaada? Wasiliana na timu yetu kwa usaidizi wa saizi.</li>
</ul>`,
  },
  {
    id: 'bridal-gowns',
    name: 'Bridal & Evening Gowns',
    description: 'Specialized size guide for gowns, formal dresses, and bridal wear with detailed measurements',
    contentEn: `<h2>Gown Measurement Guide</h2>
<p>Gowns require precise measurements for the perfect fit. We recommend having someone else take your measurements for accuracy.</p>

<h3>Key Measurements</h3>
<ul>
  <li><strong>Bust:</strong> Measure around the fullest part of your bust while wearing the bra you plan to wear with the gown.</li>
  <li><strong>Under-Bust:</strong> Measure directly under your bust, snug but comfortable.</li>
  <li><strong>Waist:</strong> Measure at your natural waistline (the narrowest point).</li>
  <li><strong>Hips:</strong> Measure at the widest point of your hips (approximately 20cm below waist).</li>
  <li><strong>Hollow to Hem:</strong> Measure from the hollow of your neck (between collarbones) straight down to the floor.</li>
  <li><strong>Arm Length:</strong> Measure from shoulder to wrist with arm slightly bent.</li>
</ul>

<h2>Gown Size Chart</h2>
<table>
  <thead>
    <tr><th>Size</th><th>Bust (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th><th>Hollow to Hem (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>2 / XS</td><td>80-83</td><td>60-63</td><td>87-90</td><td>140-142</td></tr>
    <tr><td>4 / S</td><td>84-87</td><td>64-67</td><td>91-94</td><td>142-144</td></tr>
    <tr><td>6 / S</td><td>88-90</td><td>68-70</td><td>95-97</td><td>144-146</td></tr>
    <tr><td>8 / M</td><td>91-94</td><td>71-74</td><td>98-101</td><td>146-148</td></tr>
    <tr><td>10 / M</td><td>95-97</td><td>75-77</td><td>102-104</td><td>148-150</td></tr>
    <tr><td>12 / L</td><td>98-101</td><td>78-81</td><td>105-108</td><td>150-152</td></tr>
    <tr><td>14 / L</td><td>102-105</td><td>82-85</td><td>109-112</td><td>152-154</td></tr>
    <tr><td>16 / XL</td><td>106-110</td><td>86-90</td><td>113-117</td><td>154-156</td></tr>
    <tr><td>18 / XXL</td><td>111-116</td><td>91-96</td><td>118-123</td><td>156-158</td></tr>
  </tbody>
</table>

<h2>Rental Gown Tips</h2>
<ul>
  <li>Gowns can be altered within 1-2 sizes for a perfect fit. Minor alterations are complimentary.</li>
  <li>We recommend booking a fitting appointment at least 2 weeks before your event.</li>
  <li>If between sizes, order the larger size — it's easier to take in than let out.</li>
  <li>Bring the shoes and undergarments you plan to wear at your fitting.</li>
</ul>`,
    contentSw: `<h2>Mwongozo wa Kupima Gauni</h2>
<p>Magauni yanahitaji vipimo sahihi kwa mtindo unaofaa. Tunapendekeza mtu mwingine akupimie kwa usahihi.</p>

<h3>Vipimo Muhimu</h3>
<ul>
  <li><strong>Kifua:</strong> Pima sehemu pana ya kifua ukiwa umevaa sidiria utakayovaa na gauni.</li>
  <li><strong>Chini ya Kifua:</strong> Pima chini ya kifua, kwa urahisi.</li>
  <li><strong>Kiuno:</strong> Pima sehemu nyembamba ya kiuno chako.</li>
  <li><strong>Makalio:</strong> Pima sehemu pana zaidi ya makalio (takriban sm 20 chini ya kiuno).</li>
  <li><strong>Shingo hadi Upindo:</strong> Pima kutoka shingo hadi sakafuni.</li>
  <li><strong>Urefu wa Mkono:</strong> Pima kutoka begani hadi kifundoni, mkono ukiwa umepinda kidogo.</li>
</ul>

<h2>Chati ya Saizi za Gauni</h2>
<table>
  <thead>
    <tr><th>Saizi</th><th>Kifua (cm)</th><th>Kiuno (cm)</th><th>Makalio (cm)</th><th>Shingo-Upindo (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>2 / XS</td><td>80-83</td><td>60-63</td><td>87-90</td><td>140-142</td></tr>
    <tr><td>4 / S</td><td>84-87</td><td>64-67</td><td>91-94</td><td>142-144</td></tr>
    <tr><td>6 / S</td><td>88-90</td><td>68-70</td><td>95-97</td><td>144-146</td></tr>
    <tr><td>8 / M</td><td>91-94</td><td>71-74</td><td>98-101</td><td>146-148</td></tr>
    <tr><td>10 / M</td><td>95-97</td><td>75-77</td><td>102-104</td><td>148-150</td></tr>
    <tr><td>12 / L</td><td>98-101</td><td>78-81</td><td>105-108</td><td>150-152</td></tr>
    <tr><td>14 / L</td><td>102-105</td><td>82-85</td><td>109-112</td><td>152-154</td></tr>
    <tr><td>16 / XL</td><td>106-110</td><td>86-90</td><td>113-117</td><td>154-156</td></tr>
    <tr><td>18 / XXL</td><td>111-116</td><td>91-96</td><td>118-123</td><td>156-158</td></tr>
  </tbody>
</table>

<h2>Vidokezo vya Kukodisha Gauni</h2>
<ul>
  <li>Magauni yanaweza kubadilishwa ndani ya saizi 1-2 kwa mtindo unaofaa. Marekebisho madogo ni bure.</li>
  <li>Tunapendekeza kupanga miadi ya kupima angalau wiki 2 kabla ya tukio lako.</li>
  <li>Ukiwa kati ya saizi, agiza saizi kubwa — ni rahisi kupunguza kuliko kuongeza.</li>
  <li>Lete viatu na nguo za ndani utakazovaa kwenye miadi yako ya kupima.</li>
</ul>`,
  },
  {
    id: 'african-fashion',
    name: 'African & Kitenge Fashion',
    description: 'Size guide for African traditional wear, Kitenge, Kanga, and tailored African designs',
    contentEn: `<h2>African Fashion Sizing</h2>
<p>African fashion often features custom tailoring. These measurements will help you find the perfect fit for our ready-to-wear collection.</p>

<h3>How to Measure</h3>
<ul>
  <li><strong>Bust:</strong> Measure around the fullest part of your chest.</li>
  <li><strong>Waist:</strong> Measure at your natural waistline.</li>
  <li><strong>Hips:</strong> Measure around the widest part of your hips.</li>
  <li><strong>Dress Length:</strong> From shoulder to desired hem length.</li>
  <li><strong>Skirt Length:</strong> From waist to desired hem length.</li>
  <li><strong>Shoulder Width:</strong> From one shoulder edge to the other across the back.</li>
</ul>

<h2>Women's African Wear</h2>
<table>
  <thead>
    <tr><th>Size</th><th>Bust (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th><th>Shoulder (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>S (8-10)</td><td>84-90</td><td>66-72</td><td>92-98</td><td>37-38</td></tr>
    <tr><td>M (12-14)</td><td>91-97</td><td>73-79</td><td>99-105</td><td>39-40</td></tr>
    <tr><td>L (16-18)</td><td>98-106</td><td>80-88</td><td>106-114</td><td>41-42</td></tr>
    <tr><td>XL (20-22)</td><td>107-115</td><td>89-97</td><td>115-123</td><td>43-44</td></tr>
    <tr><td>XXL (24-26)</td><td>116-124</td><td>98-106</td><td>124-132</td><td>45-46</td></tr>
  </tbody>
</table>

<h2>Men's African Wear (Dashiki, Kaftan)</h2>
<table>
  <thead>
    <tr><th>Size</th><th>Chest (cm)</th><th>Shoulder (cm)</th><th>Length (cm)</th><th>Sleeve (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>S</td><td>96-100</td><td>44-46</td><td>72-74</td><td>60-62</td></tr>
    <tr><td>M</td><td>101-106</td><td>47-49</td><td>75-77</td><td>63-65</td></tr>
    <tr><td>L</td><td>107-114</td><td>50-52</td><td>78-80</td><td>66-68</td></tr>
    <tr><td>XL</td><td>115-122</td><td>53-55</td><td>81-83</td><td>69-71</td></tr>
    <tr><td>XXL</td><td>123-130</td><td>56-58</td><td>84-86</td><td>72-74</td></tr>
  </tbody>
</table>

<h2>Custom Tailoring</h2>
<p>Many of our African designs can be custom-tailored to your exact measurements. Contact us for bespoke orders — turnaround time is typically 5-10 business days.</p>`,
    contentSw: `<h2>Saizi za Mitindo ya Kiafrika</h2>
<p>Mitindo ya Kiafrika mara nyingi hutengenezwa kwa kupimwa. Vipimo hivi vitakusaidia kupata saizi inayofaa kwa mkusanyiko wetu.</p>

<h3>Jinsi ya Kupima</h3>
<ul>
  <li><strong>Kifua:</strong> Pima sehemu pana zaidi ya kifua chako.</li>
  <li><strong>Kiuno:</strong> Pima sehemu nyembamba ya kiuno.</li>
  <li><strong>Makalio:</strong> Pima sehemu pana ya makalio.</li>
  <li><strong>Urefu wa Gauni:</strong> Kutoka begani hadi urefu unaotaka.</li>
  <li><strong>Urefu wa Sketi:</strong> Kutoka kiuno hadi urefu unaotaka.</li>
  <li><strong>Upana wa Bega:</strong> Kutoka bega moja hadi lingine.</li>
</ul>

<h2>Mavazi ya Kiafrika ya Wanawake</h2>
<table>
  <thead>
    <tr><th>Saizi</th><th>Kifua (cm)</th><th>Kiuno (cm)</th><th>Makalio (cm)</th><th>Bega (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>S (8-10)</td><td>84-90</td><td>66-72</td><td>92-98</td><td>37-38</td></tr>
    <tr><td>M (12-14)</td><td>91-97</td><td>73-79</td><td>99-105</td><td>39-40</td></tr>
    <tr><td>L (16-18)</td><td>98-106</td><td>80-88</td><td>106-114</td><td>41-42</td></tr>
    <tr><td>XL (20-22)</td><td>107-115</td><td>89-97</td><td>115-123</td><td>43-44</td></tr>
    <tr><td>XXL (24-26)</td><td>116-124</td><td>98-106</td><td>124-132</td><td>45-46</td></tr>
  </tbody>
</table>

<h2>Mavazi ya Kiafrika ya Wanaume (Dashiki, Kaftan)</h2>
<table>
  <thead>
    <tr><th>Saizi</th><th>Kifua (cm)</th><th>Bega (cm)</th><th>Urefu (cm)</th><th>Mkono (cm)</th></tr>
  </thead>
  <tbody>
    <tr><td>S</td><td>96-100</td><td>44-46</td><td>72-74</td><td>60-62</td></tr>
    <tr><td>M</td><td>101-106</td><td>47-49</td><td>75-77</td><td>63-65</td></tr>
    <tr><td>L</td><td>107-114</td><td>50-52</td><td>78-80</td><td>66-68</td></tr>
    <tr><td>XL</td><td>115-122</td><td>53-55</td><td>81-83</td><td>69-71</td></tr>
    <tr><td>XXL</td><td>123-130</td><td>56-58</td><td>84-86</td><td>72-74</td></tr>
  </tbody>
</table>

<h2>Ushonaji wa Kipekee</h2>
<p>Mitindo mingi ya Kiafrika inaweza kushonwa kwa vipimo vyako halisi. Wasiliana nasi kwa agizo maalum — muda wa kukamilisha ni siku 5-10 za kazi.</p>`,
  },
];
