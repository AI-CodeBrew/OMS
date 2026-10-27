"""Which Pakistani province an order's city is in - for the Dashboard's
delivery performance by province. Orders only carry a free-text city, so
this is a lookup of the cities (and common short forms) orders actually
arrive with; anything it can't place is "Unknown" rather than guessed.
"""

import re

PROVINCES = [
    "Punjab",
    "Sindh",
    "Khyber Pakhtunkhwa",
    "Balochistan",
    "Islamabad",
    "Gilgit-Baltistan",
    "Azad Kashmir",
]
UNKNOWN = "Unknown"

_CITIES = {
    "Punjab": """
        Lahore, Faisalabad, Rawalpindi, Gujranwala, Multan, Bahawalpur, Sargodha, Sialkot,
        Sheikhupura, Rahim Yar Khan, Jhang, Dera Ghazi Khan, DG Khan, Gujrat, Sahiwal, Wah Cantt,
        Wah, Kasur, Okara, Chiniot, Kamoke, Hafizabad, Sadiqabad, Burewala, Khanewal, Muzaffargarh,
        Mandi Bahauddin, Jhelum, Khanpur, Pakpattan, Daska, Gojra, Muridke, Bahawalnagar, Samundri,
        Jaranwala, Chishtian, Attock, Vehari, Kot Abdul Malik, Ferozwala, Chakwal, Kamalia,
        Ahmedpur East, Ahmadpur East, Kot Addu, Wazirabad, Layyah, Taxila, Khushab, Mianwali,
        Lodhran, Hasilpur, Bhakkar, Arifwala, Sambrial, Jatoi, Haroonabad, Narowal, Bhalwal,
        Pattoki, Kharian, Toba Tek Singh, Shorkot, Raiwind, Murree, Fort Abbas, Kahror Pacca,
        Pindi Bhattian, Mian Channu, Nankana Sahib, Shakargarh, Liaquatpur, Rajanpur, Talagang,
        Pir Mahal, Depalpur, Dipalpur, Chichawatni, Jampur, Kot Radha Kishan, Zafarwal, Pasrur,
        Lalamusa, Lala Musa, Dinga, Sarai Alamgir, Kot Momin, Phalia, Gujar Khan, Fateh Jang,
        Pind Dadan Khan, Hazro, Renala Khurd, Ahmadpur Sial, Tandlianwala, Kabirwala, Fazilpur,
        Taunsa, Dunyapur, Chunian, Shujabad, Jalalpur Pirwala, Alipur, Yazman, Basirpur,
        Sangla Hill, Safdarabad, Kamra, Mailsi, Kot Chutta, Chawinda, Kunjah, Jalalpur Jattan,
        Ugoki, Kamalia, Shahkot, Khurianwala, Sharaqpur, Ferozewala, Faisalabad Cantt,
        Lahore Cantt, Rawalpindi Cantt, Chak Jhumra, Noorpur Thal, Joharabad, Quaidabad,
        Isa Khel, Kalabagh, Piplan, Daud Khel, Darya Khan, Kallar Kahar, Choa Saidan Shah,
        Pindigheb, Jand, Chhachh, Kahuta, Kotli Sattian, Taxila Cantt, Hasan Abdal, Kot Sultan,
        Karor Lal Esan, Chaubara, Fatehpur, Rojhan, Kot Mithan, Uch Sharif, Khairpur Tamewali,
        Minchinabad, Dahranwala, Marot, Jahanian, Tibba Sultanpur, Luddan, Gaggo Mandi,
        Pirmahal, Rajana, Kamir, Harappa, Iqbal Nagar, Noorshah, Bahawalpur Cantt
    """,
    "Sindh": """
        Karachi, Hyderabad, Sukkur, Larkana, Nawabshah, Shaheed Benazirabad, Benazirabad,
        Mirpur Khas, Mirpurkhas, Jacobabad, Shikarpur, Khairpur, Khairpur Mirs, Dadu,
        Tando Allahyar, Tando Adam, Tando Muhammad Khan, Badin, Thatta, Kotri, Hala, Matiari,
        Sanghar, Shahdadpur, Umerkot, Umarkot, Mithi, Ghotki, Kandhkot, Kashmore, Moro, Sehwan,
        Jamshoro, Naushahro Feroze, Mehrabpur, Ratodero, Qambar, Kamber, Shahdadkot, Daharki,
        Mirpur Mathelo, Pano Aqil, Rohri, Gambat, Digri, Kunri, Sakrand, Tando Jam, Hingorja,
        Gharo, Sujawal, Keti Bandar, Jati, Johi, Mehar, Khairpur Nathan Shah, Kandiaro,
        Bhiria, Daulatpur, Sinjhoro, Jhol, Tando Ghulam Ali, Matli, Talhar, Islamkot, Diplo,
        Chachro, Nagarparkar, Sobhodero, Kingri, Thul, Garhi Khairo, Ubauro, Khanpur Mahar,
        Malir, Korangi, Gulshan e Iqbal, Clifton, Defence Karachi
    """,
    "Khyber Pakhtunkhwa": """
        Peshawar, Mardan, Mingora, Swat, Kohat, Abbottabad, Dera Ismail Khan, DI Khan, Mansehra,
        Nowshera, Charsadda, Swabi, Bannu, Haripur, Chitral, Timergara, Dir, Upper Dir, Lower Dir,
        Batkhela, Karak, Lakki Marwat, Tank, Hangu, Parachinar, Battagram, Shangla, Buner,
        Malakand, Risalpur, Tangi, Jamrud, Landi Kotal, Khyber, Bajaur, Mohmand, Kurram,
        Waziristan, North Waziristan, South Waziristan, Miranshah, Wana, Topi, Havelian, Balakot,
        Kalam, Takht Bhai, Pabbi, Shabqadar, Chakdara, Barikot, Saidu Sharif, Matta, Khwazakhela,
        Alpuri, Besham, Daggar, Thakot, Oghi, Kohistan, Dasu, Pattan, Drosh, Mastuj, Darra Adam
        Khel, Lachi, Paharpur, Kulachi, Daraban, Domel, Serai Naurang, Nowshera Cantt, Akora
        Khattak, Jahangira, Utmanzai, Tangi, Kabal, Madyan, Bahrain, Shewa Adda, Katlang,
        Rustam, Kalabat, Khalabat, Ghazi, Tarbela, Nathia Gali, Ayubia, Hayatabad,
        Shinkiari, Bisham
    """,
    "Balochistan": """
        Quetta, Turbat, Khuzdar, Hub, Hub Chowki, Chaman, Gwadar, Sibi, Zhob, Loralai,
        Dera Murad Jamali, Dera Allah Yar, Usta Muhammad, Kalat, Mastung, Nushki, Kharan,
        Panjgur, Pishin, Qila Saifullah, Ziarat, Lasbela, Uthal, Bela, Dalbandin, Jaffarabad,
        Naseerabad, Kohlu, Dera Bugti, Pasni, Ormara, Jiwani, Washuk, Awaran, Surab, Harnai,
        Musakhel, Barkhan, Sherani, Qila Abdullah, Duki, Kachhi, Bolan, Machh, Sui, Gandava,
        Jhal Magsi, Winder, Taftan, Nokkundi
    """,
    "Islamabad": """
        Islamabad, Islamabad Capital Territory, ICT
    """,
    "Gilgit-Baltistan": """
        Gilgit, Skardu, Hunza, Ghizer, Chilas, Astore, Khaplu, Aliabad, Karimabad, Shigar,
        Gahkuch, Diamer, Nagar, Gupis, Sost, Passu, Danyore, Jaglot
    """,
    "Azad Kashmir": """
        Muzaffarabad, Mirpur, Mirpur Azad Kashmir, Kotli, Bhimber, Rawalakot, Bagh, Pallandri,
        Dadyal, Hattian, Hattian Bala, Neelum, Sudhnoti, Athmuqam, Haveli, Forward Kahuta,
        Sehnsa, Khuiratta, Chakswari, Islamgarh, Barnala, Samahni, Dhirkot, Hajira, Abbaspur,
        Trarkhel, Azad Kashmir, AJK
    """,
}

# Short forms orders commonly arrive with.
_ALIASES = {
    "lhr": "Punjab", "rwp": "Punjab", "pindi": "Punjab", "fsd": "Punjab", "mul": "Punjab",
    "skt": "Punjab", "grw": "Punjab", "dgk": "Punjab", "rykhan": "Punjab", "ryk": "Punjab",
    "khi": "Sindh", "hyd": "Sindh", "isb": "Islamabad", "pew": "Khyber Pakhtunkhwa",
    "dik": "Khyber Pakhtunkhwa", "uet": "Balochistan",
}


def _key(text):
    return re.sub(r"[^a-z]", "", (text or "").lower())


_LOOKUP = {}
for _province, _names in _CITIES.items():
    for _name in _names.split(","):
        if _key(_name):
            _LOOKUP.setdefault(_key(_name), _province)
_LOOKUP.update(_ALIASES)
_LONGEST = max(len(k) for k in _LOOKUP)


def province_for_city(city):
    """The province `city` is in, or UNKNOWN. Tries the whole name first
    ("Dera Ghazi Khan", "D.G. Khan"), then any run of its words ("DHA
    Lahore Cantt" -> Lahore)."""
    whole = _key(city)
    if not whole:
        return UNKNOWN
    if whole in _LOOKUP:
        return _LOOKUP[whole]
    words = [w for w in re.split(r"[^a-z]+", (city or "").lower()) if w]
    # Longest runs first, so "Mirpur Khas" wins over "Mirpur".
    for size in range(min(len(words), 4), 0, -1):
        for start in range(len(words) - size + 1):
            run = "".join(words[start : start + size])
            if len(run) <= _LONGEST and run in _LOOKUP:
                return _LOOKUP[run]
    return UNKNOWN
