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

SELECT create_hypertable(
  'wage_data', 'date',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE
);

CREATE TABLE IF NOT EXISTS industries (
  code    VARCHAR(10)  PRIMARY KEY,
  name_en VARCHAR(100) NOT NULL,
  name_ja VARCHAR(100) NOT NULL
);

INSERT INTO industries (code, name_en, name_ja) VALUES
  ('ALL',  'All Industries',                          '産業計'),
  ('A',    'Agriculture, Forestry and Fisheries',     '農業，林業，漁業'),
  ('B',    'Mining and Quarrying',                    '鉱業，採石業，砂利採取業'),
  ('C',    'Manufacturing',                           '製造業'),
  ('D',    'Electricity, Gas, Heat and Water Supply', '電気・ガス・熱供給・水道業'),
  ('E',    'Information and Communications',          '情報通信業'),
  ('F',    'Transport and Postal Services',           '運輸業，郵便業'),
  ('G',    'Wholesale and Retail Trade',              '卸売業，小売業'),
  ('H',    'Finance and Insurance',                   '金融業，保険業'),
  ('I',    'Real Estate and Goods Rental',            '不動産業，物品賃貸業'),
  ('J',    'Scientific and Technical Services',       '学術研究，専門・技術サービス業'),
  ('K',    'Accommodations and Food Services',        '宿泊業，飲食サービス業'),
  ('L',    'Living Services and Entertainment',       '生活関連サービス業，娯楽業'),
  ('M',    'Education and Learning Support',          '教育，学習支援業'),
  ('N',    'Medical, Health Care and Welfare',        '医療，福祉'),
  ('O',    'Compound Services',                       '複合サービス事業'),
  ('P',    'Other Services',                          'サービス業（他に分類されないもの）'),
  ('Q',    'Government',                              '公務（他に分類されるものを除く）')
ON CONFLICT (code) DO NOTHING;
