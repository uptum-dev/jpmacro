CREATE TABLE IF NOT EXISTS wage_data (
  date           DATE         NOT NULL,
  industry_code  VARCHAR(10)  NOT NULL DEFAULT 'ALL',
  wage_type      VARCHAR(20)  NOT NULL,
  value          NUMERIC(10, 2),
  base_year      SMALLINT     NOT NULL DEFAULT 2020,
  is_preliminary BOOLEAN      NOT NULL DEFAULT false,
  source         VARCHAR(50)  NOT NULL,
  retrieved_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, industry_code, wage_type)
);

CREATE TABLE IF NOT EXISTS industries (
  code    VARCHAR(10)  PRIMARY KEY,
  name_en VARCHAR(100) NOT NULL,
  name_ja VARCHAR(100) NOT NULL
);

-- 日本標準産業分類（2007年11月改定）に準拠 / Japanese Standard Industry Classification (2007 rev.)
INSERT INTO industries (code, name_en, name_ja) VALUES
  ('ALL', 'All Industries',                          '産業計'),
  ('A',   'Agriculture and Forestry',                '農業，林業'),
  ('B',   'Fisheries',                               '漁業'),
  ('C',   'Mining and Quarrying',                    '鉱業，採石業，砂利採取業'),
  ('D',   'Construction',                            '建設業'),
  ('E',   'Manufacturing',                           '製造業'),
  ('F',   'Electricity, Gas, Heat and Water Supply', '電気・ガス・熱供給・水道業'),
  ('G',   'Information and Communications',          '情報通信業'),
  ('H',   'Transport and Postal Services',           '運輸業，郵便業'),
  ('I',   'Wholesale and Retail Trade',              '卸売業，小売業'),
  ('J',   'Finance and Insurance',                   '金融業，保険業'),
  ('K',   'Real Estate and Goods Rental',            '不動産業，物品賃貸業'),
  ('L',   'Scientific and Technical Services',       '学術研究，専門・技術サービス業'),
  ('M',   'Accommodations and Food Services',        '宿泊業，飲食サービス業'),
  ('N',   'Living Services and Entertainment',       '生活関連サービス業，娯楽業'),
  ('O',   'Education and Learning Support',          '教育，学習支援業'),
  ('P',   'Medical, Health Care and Welfare',        '医療，福祉'),
  ('Q',   'Compound Services',                       '複合サービス事業'),
  ('R',   'Other Services',                          'サービス業（他に分類されないもの）'),
  ('S',   'Government',                              '公務（他に分類されるものを除く）')
ON CONFLICT (code) DO NOTHING;
